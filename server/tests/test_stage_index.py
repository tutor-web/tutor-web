import unittest
import urllib.parse


from .requires_postgresql import RequiresPostgresql
from .requires_pyramid import RequiresPyramid
from .requires_materialbank import RequiresMaterialBank

from tutorweb_quizdb.stage.index import stage_index

AWARD_STAGE_ANSWERED = 1
AWARD_STAGE_ACED = 10
AWARD_TUTORIAL_ACED = 100
AWARD_UGMATERIAL_CORRECT = 1000
AWARD_UGMATERIAL_ACCEPTED = 10000


class StageIndexTest(RequiresMaterialBank, RequiresPyramid, RequiresPostgresql, unittest.TestCase):
    maxDiff = None

    def test_call(self):
        from tutorweb_quizdb import DBSession
        self.DBSession = DBSession

        # Add stages
        self.db_stages = self.create_stages(1, lec_parent='ut.ans_queue.0', stage_setting_spec_fn=lambda i: dict(
            allocation_method=dict(value='passthrough'),
            allocation_bank_name=dict(value=self.material_bank.name),

            ugreview_minreviews=dict(value=3),
            ugreview_captrue=dict(value=50),
            ugreview_capfalse=dict(value=-50),

            award_stage_answered=dict(value=AWARD_STAGE_ANSWERED),
            award_stage_aced=dict(value=AWARD_STAGE_ACED),
            award_tutorial_aced=dict(value=AWARD_TUTORIAL_ACED),
            award_ugmaterial_correct=dict(value=AWARD_UGMATERIAL_CORRECT),
            award_ugmaterial_accepted=dict(value=AWARD_UGMATERIAL_ACCEPTED),
        ), material_tags_fn=lambda i: [
            'type.question',
            'lec050500',
        ])
        DBSession.flush()

        self.db_studs = self.create_students(2)
        DBSession.flush()

        # Fetch stage_index
        out = stage_index(self.request(user=self.db_studs[0], params=dict(path=self.db_stages[0])))
        m_qs = urllib.parse.parse_qs(urllib.parse.urlparse(out['material_uri']).query)
        # material_uri path contains stage path
        self.assertEqual(m_qs['path'][0], out['path'])
        # material_uri path has a hash
        hash_1 = m_qs['hash'][0]
        self.assertEqual(len(hash_1), 40)
