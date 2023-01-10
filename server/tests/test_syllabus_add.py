import unittest
import unittest.mock

from sqlalchemy_utils import Ltree

from .requires_postgresql import RequiresPostgresql
from .requires_pyramid import RequiresPyramid

from tutorweb_quizdb import DBSession, Base, ACTIVE_HOST
from tutorweb_quizdb.subscriptions.available import view_subscription_available



class LecImportTest(RequiresPyramid, RequiresPostgresql, unittest.TestCase):
    maxDiff = None

    def test_nesting(self):
        self.DBSession = DBSession

        self.lec_import({'def_stages.inc': '''
[stage.stage0]
title = UT stage 0
material_tags=path.utstage0

[stage.stage1]
title = UT stage 1
material_tags=path.utstage1
        ''', 'ut.lec_import.0.ini': '''
# TW:BASE ./def_stages.inc
[titles]
ut = UT
lec_import = Lec Import
0 = Zero

[lectures]
lec0 = UT lec0
lec1 = UT lec1

[stage.stage1]
material_tags=
    path.utstage1a
    hello
        '''})
        stages = (DBSession.query(Base.classes.stage)
                           .join(Base.classes.syllabus)
                           .filter_by(host_id=ACTIVE_HOST)
                           .filter_by(path=Ltree('ut.lec_import.0.lec0'))
                           .all())
        # Titles as per include
        self.assertEqual(
            [s.title for s in stages],
            ['UT stage 0', 'UT stage 1'],
        )
        # Overrode material_tags
        self.assertEqual(
            [s.material_tags for s in stages],
            [['path.utstage0'], ['path.utstage1a', 'hello']],
        )

    def test_delete_lec(self):
        self.DBSession = DBSession

        (stud, clairvoyant) = self.create_students(2, student_group_fn=lambda i: ['accept_terms', 'admin.deleted'] if i == 1 else ['accept_terms'])

        def simple_tree(vsa):
            out = [str(vsa.get('path', ''))]
            for c in vsa.get('children', []):
                out.append(simple_tree(c))
            return out

        self.lec_import({'ut.lec_import.0.ini': '''
[titles]
ut = UT
lec_import = Lec Import
0 = Zero

[lectures]
lec0 = UT lec0
lec1 = UT lec1

[stage.stage0]
title = UT stage 0
material_tags=

[stage.stage1]
title = UT stage 1
material_tags=
        '''})
        self.lec_import({'ut.lec_import.1.ini': '''
[titles]
ut = UT
lec_import = Lec Import
1 = One

[lectures]
leca = UT leca
lecb = UT lecb

[stage.stage0]
title = UT stage 0
material_tags=

[stage.stage1]
title = UT stage 1
material_tags=
        '''})
        self.assertEqual(
            simple_tree(view_subscription_available(self.request(user=stud))),
            ['', ['ut', ['ut.lec_import', [
                'ut.lec_import.0',
                ['ut.lec_import.0.lec0'],
                ['ut.lec_import.0.lec1'],
            ], [
                'ut.lec_import.1',
                ['ut.lec_import.1.leca'],
                ['ut.lec_import.1.lecb'],
            ]]]])

        # Remove a lecture, goes away
        self.lec_import({'ut.lec_import.0.ini': '''
[titles]
ut = UT
lec_import = Lec Import
0 = Zero

[lectures]
lec0 = UT lec0
lec9 = UT lec9

[stage.stage0]
title = UT stage 0
material_tags=

[stage.stage1]
title = UT stage 1
material_tags=
        '''})
        self.assertEqual(
            simple_tree(view_subscription_available(self.request(user=stud))),
            ['', ['ut', ['ut.lec_import', [
                'ut.lec_import.0',
                ['ut.lec_import.0.lec0'],
                ['ut.lec_import.0.lec9'],
            ], [
                'ut.lec_import.1',
                ['ut.lec_import.1.leca'],
                ['ut.lec_import.1.lecb'],
            ]]]])

        # clairvoyant can see dead items
        self.assertEqual(
            simple_tree(view_subscription_available(self.request(user=clairvoyant))),
            ['', ['ut', ['ut.lec_import', [
                'ut.lec_import.0',
                ['ut.lec_import.0.lec0'],
                ['ut.lec_import.0.lec1'],
                ['ut.lec_import.0.lec9'],
            ], [
                'ut.lec_import.1',
                ['ut.lec_import.1.leca'],
                ['ut.lec_import.1.lecb'],
            ]]]])
