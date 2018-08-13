import unittest

from tutorweb_quizdb.stage.allocation import get_allocation


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

    def test_should_refresh_questions(self):
        """Refresh based on refresh_interval"""
        alloc_a = get_allocation(dict(
            allocation_method='original',
            allocation_seed=44,
            allocation_encryption_key='toottoottoot',
            allocation_refresh_interval=10,
        ), 'fake_db_stage', 'fake_db_student')

        self.assertFalse(alloc_a.should_refresh_questions([], 0))
        self.assertFalse(alloc_a.should_refresh_questions([dict()] * 5, 1))
        # NB: additions are already included in the answer queue by this point
        self.assertTrue(alloc_a.should_refresh_questions([dict()] * 10, 5))
        self.assertTrue(alloc_a.should_refresh_questions([dict()] * 11, 2))
        self.assertTrue(alloc_a.should_refresh_questions([dict()] * 22, 5))