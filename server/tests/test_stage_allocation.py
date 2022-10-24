import unittest

from .requires_postgresql import RequiresPostgresql
from .requires_pyramid import RequiresPyramid
from .requires_materialbank import RequiresMaterialBank
from .test_stage_answer_queue import aq_dict

from tutorweb_quizdb.stage.allocation import get_allocation
from tutorweb_quizdb.stage.answer_queue import sync_answer_queue


class OriginalAllocationTest(unittest.TestCase):
    def test_to_from_public_id(self):
        """to/from public_id should be able to recover information"""
        alloc_a = get_allocation(dict(
            allocation_method='original',
            allocation_seed=44,
            allocation_encryption_key='toottoottoot',
        ), 'fake_db_stage', 'fake_db_student')

        self.assertEqual((11, 34), alloc_a.from_public_id(alloc_a.to_public_id(11, 34)))
        self.assertEqual((33, 31), alloc_a.from_public_id(alloc_a.to_public_id(33, 31)))
        self.assertNotEqual(
            alloc_a.to_public_id(11, 34),
            alloc_a.to_public_id(33, 31),
        )

        alloc_b = get_allocation(dict(
            allocation_method='original',
            allocation_seed=44,
            allocation_encryption_key='parpparpparp',
        ), 'fake_db_stage', 'fake_db_student')

        self.assertEqual((11, 34), alloc_b.from_public_id(alloc_b.to_public_id(11, 34)))
        self.assertEqual((33, 31), alloc_b.from_public_id(alloc_b.to_public_id(33, 31)))
        self.assertNotEqual(
            alloc_b.to_public_id(11, 34),
            alloc_b.to_public_id(33, 31),
        )

        # The 2 allocations don't generate the same public IDs
        self.assertNotEqual(
            alloc_a.to_public_id(11, 34),
            alloc_b.to_public_id(11, 34),
        )


class OriginalAllocationDBTest(RequiresPyramid, RequiresMaterialBank, RequiresPostgresql, unittest.TestCase):
    def test_get_material(self):
        self.mb_write_example('common1_question.q.R', ('all', 'common1',), 3)
        self.mb_write_example('common2_question.q.R', ('all', 'common2',), 3)
        self.mb_update()

        self.db_stages = self.create_stages(3, lambda i: dict(
        ), lambda i: [
            'type.question',
            'all' if i == 0 else 'common%d' % (i // 2 + 1),
        ])
        self.db_studs = self.create_students(3)

        alloc_a = get_allocation(dict(
            allocation_method='original',
            allocation_seed=44,
            allocation_encryption_key='toottoottoot',
        ), self.db_stages[0], self.db_studs[0])
        out = [(self.mb_lookup_mss_id(x[0]).path, x[1]) for x in alloc_a.get_material()]
        self.assertEqual(set(out), set([
            ('common1_question.q.R', 1),
            ('common1_question.q.R', 2),
            ('common1_question.q.R', 3),
            ('common2_question.q.R', 1),
            ('common2_question.q.R', 2),
            ('common2_question.q.R', 3),
        ]))

        alloc_a = get_allocation(dict(
            allocation_method='original',
            allocation_seed=44,
            allocation_encryption_key='toottoottoot',
        ), self.db_stages[1], self.db_studs[0])
        out = [(self.mb_lookup_mss_id(x[0]).path, x[1]) for x in alloc_a.get_material()]
        self.assertEqual(set(out), set([
            ('common1_question.q.R', 1),
            ('common1_question.q.R', 2),
            ('common1_question.q.R', 3),
        ]))

        alloc_a = get_allocation(dict(
            allocation_method='original',
            allocation_seed=44,
            allocation_encryption_key='toottoottoot',
        ), self.db_stages[2], self.db_studs[0])
        out = [(self.mb_lookup_mss_id(x[0]).path, x[1]) for x in alloc_a.get_material()]
        self.assertEqual(set(out), set([
            ('common2_question.q.R', 1),
            ('common2_question.q.R', 2),
            ('common2_question.q.R', 3),
        ]))

        # TODO: Test capping / sampling

    def test_material_hash(self):
        """Refresh based on refresh_interval"""
        self.mb_write_example('common1_question.q.R', ('all', 'common1',), 3)
        self.mb_write_example('common2_question.q.R', ('all', 'common2',), 3)
        self.mb_update()

        self.db_stages = self.create_stages(3, lambda i: dict(
        ), lambda i: [
            'type.question',
            'all' if i == 0 else 'common%d' % (i // 2 + 1),
        ])
        self.db_studs = self.create_students(3)

        alloc_a = get_allocation(dict(
            allocation_method='original',
            allocation_seed=44,
            allocation_encryption_key='toottoottoot',
            allocation_refresh_interval=10,
            question_cap=2,
        ), self.db_stages[0], self.db_studs[0])
        out = [(self.mb_lookup_mss_id(x[0]).path, x[1]) for x in alloc_a.get_material()]
        hash_0 = alloc_a.material_hash()
        self.assertEqual(len(hash_0), 40)

        material_a = [alloc_a.to_public_id(a, b) for a, b in alloc_a.get_material()]

        # 2 questions, has hasn't changed
        (out, additions) = sync_answer_queue(alloc_a, [
            aq_dict(uri=material_a[0], time_end=1010),
            aq_dict(uri=material_a[1], time_end=1020),
        ], 0)
        self.assertEqual(additions, 2)
        hash_1 = alloc_a.material_hash()
        self.assertEqual(hash_1, hash_0)

        # 9 more questions, will change
        (out, additions) = sync_answer_queue(alloc_a, [
            aq_dict(uri=material_a[0], time_end=1030),
            aq_dict(uri=material_a[1], time_end=1040),
            aq_dict(uri=material_a[0], time_end=1050),
            aq_dict(uri=material_a[1], time_end=1060),
            aq_dict(uri=material_a[0], time_end=1070),
            aq_dict(uri=material_a[1], time_end=1080),
            aq_dict(uri=material_a[0], time_end=1090),
            aq_dict(uri=material_a[1], time_end=1100),
            aq_dict(uri=material_a[1], time_end=1110),
        ], 0)
        self.assertEqual(additions, 9)
        hash_2 = alloc_a.material_hash()
        self.assertEqual(len(hash_2), 40)
        self.assertNotEqual(hash_2, hash_0)
