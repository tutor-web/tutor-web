import concurrent.futures
import unittest
import time

import rpy2.robjects as robjects

from tutorweb_quizdb.material.render import material_render, MissingDataException
from tutorweb_quizdb.material.renderer.r import rob_to_dict

from .requires_materialbank import RequiresMaterialBank


class RobToDictTest(unittest.TestCase):
    def test_call(self):
        # String Vectors turn into lists
        self.assertEqual(
            rob_to_dict(robjects.r('''c('poop', 'parp')''')),
            ['poop', 'parp']
        )

        # Lists turn into dicts
        self.assertEqual(
            rob_to_dict(robjects.r('''list(poop = 12, parp = 49)''')),
            dict(poop=[12], parp=[49])
        )

        # Lists without names produce another list
        self.assertEqual(
            rob_to_dict(robjects.r('''list(12, 49)''')),
            [12, 49]
        )

        # It's recursive
        self.assertEqual(
            rob_to_dict(robjects.r('''list(poop = list(pop=list(pam="moo")), parp = 49)''')),
            dict(poop=dict(pop=dict(pam=["moo"])), parp=[49])
        )

        # NULL and NA are squished down to None
        self.assertEqual(
            rob_to_dict(robjects.r('''list(poop = NULL, parp = NA)''')),
            dict(poop=None, parp=[None])
        )


class MaterialRenderTest(RequiresMaterialBank, unittest.TestCase):
    def test_material_render(self):
        """Make sure we can direct to the various renderers"""
        self.mb_write_file('example.q.R', b'''
# TW:TAGS=math099,Q-0990t0,lec050500,
# TW:PERMUTATIONS=100
question <- function(permutation, data_frames) {
    return(list(
        content = '<p class="hints">You should write a question</p>',
        correct = list('choice_correct' = list(nonempty = TRUE))
    ))
}
        ''')
        out = material_render(self.mb_fake_ms('example.q.R'), 1)
        self.assertEqual(out, dict(
            content='<p class="hints">You should write a question</p>',
            correct={'choice_correct': {'nonempty': [True]}},
            tags=['math099', 'Q-0990t0', 'lec050500', 'type.question'],  # NB: Question tags got added back in
        ))

        # We fall over if permutation count is too high
        with self.assertRaisesRegexp(ValueError, r'100 permutations'):
            out = material_render(self.mb_fake_ms('example.q.R'), 101)

    def test_material_dataframe(self):
        """We check that requested data frames are available"""
        self.mb_write_file('example.q.R', b'''
# TW:TAGS=math099,Q-0990t0,lec050500,
# TW:PERMUTATIONS=100
# TW:DATAFRAMES=agelength
question <- function(permutation, data_frames) {
    return(list(
        content = '<p class="hints">You should write a question</p>',
        correct = list('choice_correct' = list(nonempty = TRUE))
    ))
}
        ''')
        # Without dataframe, get an error
        with self.assertRaisesRegexp(MissingDataException, 'agelength'):
            out = material_render(self.mb_fake_ms('example.q.R'), 1)

        # Dataframe provided, question renders
        out = material_render(self.mb_fake_ms('example.q.R'), 1, dict(agelength=dict()))
        self.assertEqual(out, dict(
            content='<p class="hints">You should write a question</p>',
            correct={'choice_correct': {'nonempty': [True]}},
            tags=['math099', 'Q-0990t0', 'lec050500', 'type.question'],
        ))

    def test_multithread_safe(self):
        """Make sure we can make multiple calls to the the render concurrently"""
        self.mb_write_file('example.q.R', b'''
# TW:TAGS=math099,Q-0990t0,lec050500,
# TW:PERMUTATIONS=100
question <- function(permutation, data_frames) {
    return(list(
        content = paste0('<p class="hints">You should write question ', permutation, '</p>'),
        correct = list('choice_correct' = list(nonempty = TRUE))
    ))
}
        ''')

        def test_thread(perm):
            time.sleep(0.2)
            out = material_render(self.mb_fake_ms('example.q.R'), perm % 100)
            self.assertEqual(out['content'], '<p class="hints">You should write question %d</p>' % perm)
            return out

        thread_count = 100
        with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
            futures = executor.map(test_thread, range(thread_count))
            executor.shutdown(wait=True)
        self.assertEqual(
            [x['content'] for x in futures],
            ['<p class="hints">You should write question %d</p>' % i for i in range(thread_count)],
        )
