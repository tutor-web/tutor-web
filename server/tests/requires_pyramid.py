import random

from sqlalchemy_utils import Ltree

from pyramid import testing

from tutorweb_quizdb import initialize_dbsession


class RequiresPyramid():
    def setUp(self):
        super(RequiresPyramid, self).setUp()

        self.config = testing.setUp()
        if hasattr(self, 'postgresql'):
            initialize_dbsession(dict(url=self.postgresql.url()))

    def tearDown(self):
        testing.tearDown()

        super(RequiresPyramid, self).tearDown()

    def request(self, settings={}, user=None):
        request = testing.DummyRequest()
        request.registry.settings.update(settings)
        if user:
            request.user = user
        return request

    def create_stages(self, total,
                      stage_setting_spec_fn=lambda i: {},
                      material_tags_fn=lambda i: None,
                      lec_parent='dept.tutorial'):
        from tutorweb_quizdb.syllabus.add import lec_import
        from tutorweb_quizdb import DBSession, Base, ACTIVE_HOST

        lec_name = 'lec_%d' % random.randint(1000000, 9999999)
        lec_import(dict(
            path=lec_parent,
            titles=['UT %s' % p for p in lec_parent.split('.')],
            requires_group=None,
            lectures=[[lec_name, 'UT Lecture %s' % lec_name]],
            stage_template=[dict(
                name='stage%d' % i, version=0,
                title='UT stage %s' % i,
                material_tags=material_tags_fn(i),
                setting_spec=stage_setting_spec_fn(i),
            ) for i in range(total)],
        ))

        # Get the sqlalchemy objects back
        stages = (DBSession.query(Base.classes.stage)
                           .join(Base.classes.syllabus)
                           .filter_by(host_id=ACTIVE_HOST)
                           .filter_by(path=Ltree('%s.%s' % (lec_parent, lec_name)))
                           .all())
        return stages

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
