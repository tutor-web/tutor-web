import configparser
import os.path
import json
import random
import tempfile

from sqlalchemy_utils import Ltree

from pyramid import testing

import tutorweb_quizdb


class RequiresPyramid():
    def setUp(self):
        super(RequiresPyramid, self).setUp()

        self.config = testing.setUp()
        if hasattr(self, 'postgresql'):
            self.db_session = tutorweb_quizdb.initialize_dbsession(dict(url=self.postgresql.url()))
        self.lec_import_path = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.lec_import_path.cleanup()
        if hasattr(self, 'db_session'):
            self.db_session.remove()
        testing.tearDown()

        super(RequiresPyramid, self).tearDown()

    def functional_test(self):
        from webtest import TestApp

        return TestApp(tutorweb_quizdb.main({}, **{
            "pyramid.includes": "pyramid_mailer.testing",
            "sqlalchemy.url": self.postgresql.url(),
            "sqlalchemy.echo": "false",
            "mako.directories": "tutorweb_quizdb: tutorweb_quizdb:auth/",
        }))

    def lec_import(self, file_contents):
        from tutorweb_quizdb.syllabus.add import lec_import

        for name, content in file_contents.items():
            with open(os.path.join(self.lec_import_path.name, name), 'w') as f:
                if isinstance(content, str):
                    f.write(content.strip())
                elif isinstance(content, configparser.ConfigParser):
                    content.write(f)
                else:
                    raise ValueError("Unexpected lecture type %s" % content)
        lec_import(os.path.join(self.lec_import_path.name, name))  # NB: name is final item from loop

    def request(self, settings={}, user=None, params={}, method='GET', body=None):
        request = testing.DummyRequest(method=method)
        request.registry.settings.update(settings)
        request.user = user
        request.params = params
        if body:
            setattr(request, 'json', body)

        if 'sqlalchemy.ext.automap.stage' in str(request.params.get('path', None).__class__):
            # Munge a stage option into the required path
            request.params['path'] = str(request.params['path'].syllabus.path + Ltree(request.params['path'].stage_name))
        return request

    def create_stages(self, total,
                      stage_setting_spec_fn=lambda i: {},
                      material_tags_fn=lambda i: [],
                      requires_group=None,
                      lec_parent='dept.tutorial'):
        from tutorweb_quizdb import DBSession, Base, ACTIVE_HOST
        from tutorweb_quizdb.syllabus.add import new_tutorial_config

        lec_name = 'lec_%d' % random.randint(1000000, 9999999)
        conf_out = new_tutorial_config()
        conf_out['titles'] = {p:"UT %s" % p for p in lec_parent.split('.')}
        conf_out['requires_group']['_'] = requires_group or ''
        conf_out['lectures'][lec_name] = 'UT Lecture %s' % lec_name
        for i in range(total):
            stage_name = 'stage.stage%d' % i
            conf_out.add_section(stage_name)
            conf_out[stage_name]['title'] = 'UT stage %d' % i
            conf_out[stage_name]['material_tags'] = "\n".join(material_tags_fn(i))
            for k, v in stage_setting_spec_fn(i).items():
                conf_out[stage_name][k] = json.dumps(v)
        self.lec_import({"%s.ini" % lec_parent: conf_out})

        # Get the sqlalchemy objects back
        stages = (DBSession.query(Base.classes.stage)
                           .join(Base.classes.syllabus)
                           .filter_by(host_id=ACTIVE_HOST)
                           .filter_by(path=Ltree('%s.%s' % (lec_parent, lec_name)))
                           .all())
        if len(stages) != total:
            raise ValueError("Failed to import lecture, %d stages returned, not %d" % (len(stages), total))
        return stages

    def upgrade_stage(self, db_stage, setting_spec_updates):
        from tutorweb_quizdb import DBSession, Base

        # Add it, let the database worry about bumping version
        new_spec = db_stage.stage_setting_spec.copy()
        new_spec.update(setting_spec_updates)
        new_stage = Base.classes.stage(
            syllabus=db_stage.syllabus,
            stage_name=db_stage.stage_name,
            title=db_stage.title,
            material_tags=db_stage.material_tags,
            stage_setting_spec=new_spec,
        )
        DBSession.add(new_stage)
        DBSession.flush()
        return new_stage

    def create_students(self, total, student_group_fn=lambda i: ['accept_terms']):
        from tutorweb_quizdb.student.create import create_student

        out = []
        for i in range(total):
            (user, pwd) = create_student(
                self.request(),
                'user%d' % i,
                email='user%d@example.com' % i,
                assign_password=True,
                group_names=student_group_fn(i),
            )
            out.append(user)

        return out
