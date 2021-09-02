from decimal import Decimal
import unittest

from pyramid.httpexceptions import HTTPForbidden

from .requires_postgresql import RequiresPostgresql
from .requires_pyramid import RequiresPyramid
from .requires_materialbank import RequiresMaterialBank

from tutorweb_quizdb.stage.allocation import get_allocation
from tutorweb_quizdb.stage.setting import getStudentSettings
from tutorweb_quizdb.stage.answer_queue import sync_answer_queue, request_review
from tutorweb_quizdb.stage.material import stage_material
from tutorweb_quizdb.syllabus.results import result_summary, result_full, view_syllabus_results
from tutorweb_quizdb.student import get_group


AWARD_STAGE_ANSWERED = 1
AWARD_STAGE_ACED = 10
AWARD_TUTORIAL_ACED = 100
AWARD_UGMATERIAL_CORRECT = 1000
AWARD_UGMATERIAL_ACCEPTED = 10000


def aq_dict(**d):
    """Fill in the boring bits of an answer queue entry"""
    if 'ug_reviews' not in d:
        d['ug_reviews'] = []
    d['synced'] = True
    if 'client_id' not in d:
        d['client_id'] = '01'
    if 'review' not in d:
        d['review'] = None
    if 'time_start' not in d:
        d['time_start'] = d['time_end'] - 10
    if 'time_offset' not in d:
        d['time_offset'] = 0
    if 'correct' not in d:
        d['correct'] = True
    if 'student_answer' not in d:
        d['student_answer'] = {}
    if 'grade_after' not in d:
        d['grade_after'] = 0.1
    if 'mark' not in d:
        d['mark'] = 0
    return d


def get_alloc(db_stage, db_student):
    """Get settings & allocation in one step"""
    settings = getStudentSettings(db_stage, db_student)
    alloc = get_allocation(settings, db_stage, db_student)
    return alloc


def get_material(db_stage, db_student):
    """Get available material for stage/student in public ID form"""
    alloc = get_alloc(db_stage, db_student)
    return [alloc.to_public_id(*x) for x in alloc.get_material()]


class SyncAnswerQueueTest(RequiresMaterialBank, RequiresPyramid, RequiresPostgresql, unittest.TestCase):
    maxDiff = None

    def coins_awarded(self, db_student):
        """Get total coins awarded to this student"""
        from tutorweb_quizdb.student.details import view_student_details

        return view_student_details(self.request(user=db_student))['millismly']

    def test_call(self):
        from tutorweb_quizdb import DBSession
        self.DBSession = DBSession

        # Add stages
        self.db_stages = self.create_stages(3, lec_parent='ut.ans_queue.0', stage_setting_spec_fn=lambda i: dict(
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
            'type.template',
            'lec050500',
        ])
        DBSession.flush()

        # Add another lecture to the same tutorial
        self.db_other_stages = self.create_stages(1, lec_parent='ut.ans_queue.0', stage_setting_spec_fn=lambda i: dict(
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

        self.db_studs = self.create_students(4)
        DBSession.flush()

        # Add material
        self.mb_write_file('example1.q.R', b'''
# TW:TAGS=math099,Q-0990t0,lec050500,
# TW:PERMUTATIONS=10

question <- function(permutation, data_frames) { return(list(content = '', correct = list())) }
        ''')
        self.mb_write_file('example2.q.R', b'''
# TW:TAGS=math099,Q-0990t0,lec050500,
# TW:PERMUTATIONS=10

question <- function(permutation, data_frames) { return(list(content = '', correct = list())) }
        ''')
        self.mb_write_file('template1.t.R', b'''
# TW:TAGS=math099,Q-0990t0,lec050500,
# TW:PERMUTATIONS=1

question <- function(permutation, data_frames) { return(list(content = '', correct = list())) }
        ''')
        self.mb_update()

        # Can sync empty answer queue with empty
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[0]), [], 0)
        self.assertEqual(out, [])
        self.assertEqual(additions, 0)

        # Nonsense items cause an error
        with self.assertRaisesRegex(ValueError, 'example9.q.R'):
            (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[0]), [
                aq_dict(time_end=2013, uri='example9.q.R:1:1', grade_after=9.9)
            ], 0)

        # Add some items into the queue, get them back again. Entries without time_end are ignored
        alloc = get_alloc(self.db_stages[0], self.db_studs[0])
        (out, additions) = sync_answer_queue(alloc, [
            dict(client_id='01', uri='example1.q.R:1:4', time_start=1000, time_end=1010, correct=True, grade_after=0.1, student_answer=dict(answer="2")),
            dict(client_id='01', uri='example1.q.R:1:5', time_start=1010, time_end=1020, correct=True, grade_after=0.1, student_answer=dict(answer="2")),
            dict(client_id='01', uri='example1.q.R:1:9', time_start=1090),
        ], 0)
        self.assertEqual(out, [
            aq_dict(uri='example1.q.R:1:4', time_start=1000, time_end=1010, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2")),
            aq_dict(uri='example1.q.R:1:5', time_start=1010, time_end=1020, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2")),
        ])
        self.assertEqual(additions, 2)

        # Questions with invalid URIs are complained about
        alloc = get_alloc(self.db_stages[0], self.db_studs[0])
        with self.assertRaisesRegex(ValueError, 'parpparpparp'):
            (out, additions) = sync_answer_queue(alloc, [
                dict(client_id='01', uri='parpparpparp', time_start=1000, time_end=1007, correct=True, grade_after=0.1, student_answer=dict(answer="2")),
            ], 0)

        # Can only add reviews to existing items
        alloc = get_alloc(self.db_stages[0], self.db_studs[0])
        (out, additions) = sync_answer_queue(alloc, [
            dict(client_id='01', uri='example1.q.R:1:4', time_start=1000, time_end=1010, correct=True, grade_after=0.1, student_answer=dict(answer="ignored"), review=dict(hard="yes")),
        ], 0)
        self.assertEqual(out, [
            aq_dict(uri='example1.q.R:1:4', time_start=1000, time_end=1010, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2"), review=dict(hard="yes")),
            aq_dict(uri='example1.q.R:1:5', time_start=1010, time_end=1020, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2")),
        ])
        self.assertEqual(additions, 0)

        # Once the review is there it doesn't get removed
        alloc = get_alloc(self.db_stages[0], self.db_studs[0])
        (out, additions) = sync_answer_queue(alloc, [
            dict(client_id='01', uri='example1.q.R:1:4', time_start=1000, time_end=1010, correct=True, grade_after=0.1, student_answer=dict(answer="ignored"), review=None),
        ], 0)
        self.assertEqual(out, [
            aq_dict(uri='example1.q.R:1:4', time_start=1000, time_end=1010, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2"), review=dict(hard="yes")),
            aq_dict(uri='example1.q.R:1:5', time_start=1010, time_end=1020, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2")),
        ])
        self.assertEqual(additions, 0)

        # Can add items with differing time_offsets
        (out, additions) = sync_answer_queue(alloc, [
            dict(client_id='01', uri='example2.q.R:1:1', time_start=1000, time_end=1010, correct=True, grade_after=0.1, student_answer=dict(answer="late"), review=None),
        ], 300)
        self.assertEqual(out, [
            aq_dict(uri='example1.q.R:1:4', time_start=1000, time_end=1010, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2"), review=dict(hard="yes")),
            aq_dict(uri='example2.q.R:1:1', time_start=1000, time_end=1010, time_offset=300, correct=True, grade_after=0.1, student_answer=dict(answer="late")),
            aq_dict(uri='example1.q.R:1:5', time_start=1010, time_end=1020, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2")),
        ])
        self.assertEqual(additions, 1)

        # Can interleave new material, get back everything
        alloc = get_alloc(self.db_stages[0], self.db_studs[0])
        (out, additions) = sync_answer_queue(alloc, [
            dict(client_id='01', uri='example1.q.R:1:6', time_start=1000, time_end=1005, time_offset=0, correct=True, grade_after=0.2, student_answer=dict(answer="3")),
            dict(client_id='01', uri='example1.q.R:1:7', time_start=1010, time_end=1015, time_offset=0, correct=True, grade_after=0.2, student_answer=dict(answer="3")),
            dict(client_id='01', uri='example1.q.R:1:8', time_start=1020, time_end=1025, time_offset=0, correct=True, grade_after=0.2, student_answer=dict(answer="3")),
        ], 0)
        self.assertEqual(out, [
            aq_dict(uri='example1.q.R:1:6', time_start=1000, time_end=1005, time_offset=0, correct=True, grade_after=0.2, student_answer=dict(answer="3")),
            aq_dict(uri='example1.q.R:1:4', time_start=1000, time_end=1010, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2"), review=dict(hard="yes")),
            aq_dict(uri='example2.q.R:1:1', time_start=1000, time_end=1010, time_offset=300, correct=True, grade_after=0.1, student_answer=dict(answer="late")),
            aq_dict(uri='example1.q.R:1:7', time_start=1010, time_end=1015, time_offset=0, correct=True, grade_after=0.2, student_answer=dict(answer="3")),
            aq_dict(uri='example1.q.R:1:5', time_start=1010, time_end=1020, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2")),
            aq_dict(uri='example1.q.R:1:8', time_start=1020, time_end=1025, time_offset=0, correct=True, grade_after=0.2, student_answer=dict(answer="3")),
        ])
        self.assertEqual(additions, 3)

        # Templates keep their sequence ID
        alloc = get_alloc(self.db_stages[0], self.db_studs[1])
        (out, additions) = sync_answer_queue(alloc, [
            dict(client_id='01', uri='template1.t.R:1:1', time_start=1000, time_end=1010, correct=None, grade_after=0.1, student_answer=dict(text="2")),
            dict(client_id='01', uri='template1.t.R:1:1', time_start=1010, time_end=1020, correct=None, grade_after=0.1, student_answer=dict(text="3")),
        ], 0)
        self.assertEqual(out, [
            aq_dict(uri='template1.t.R:1:1', time_start=1000, time_end=1010, time_offset=0, correct=None, grade_after=0.1, student_answer=dict(text="2"), review=None),
            aq_dict(uri='template1.t.R:1:1', time_start=1010, time_end=1020, time_offset=0, correct=None, grade_after=0.1, student_answer=dict(text="3"), review=None),
        ])
        self.assertEqual(additions, 2)
        (out, additions) = sync_answer_queue(alloc, [
            dict(client_id='01', uri='template1.t.R:1:1', time_start=1020, time_end=1030, correct=None, grade_after=0.1, student_answer=dict(text="4")),
        ], 0)
        self.assertEqual(out, [
            # NB: correct has been rewritten back to none, since there's no review
            aq_dict(uri='template1.t.R:1:1', time_start=1000, time_end=1010, time_offset=0, correct=None, grade_after=0.1, student_answer=dict(text="2"), review=None, ug_reviews=[]),
            aq_dict(uri='template1.t.R:1:1', time_start=1010, time_end=1020, time_offset=0, correct=None, grade_after=0.1, student_answer=dict(text="3"), review=None, ug_reviews=[]),
            aq_dict(uri='template1.t.R:1:1', time_start=1020, time_end=1030, time_offset=0, correct=None, grade_after=0.1, student_answer=dict(text="4"), review=None, ug_reviews=[]),
        ])
        self.assertEqual(additions, 1)

        # Request review lets everyone bar student 1 review stuff, student 1 gets no coins
        self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[0])), [
            dict(uri='template1.t.R:1:-7'),
            dict(uri='template1.t.R:1:-8'),
            dict(uri='template1.t.R:1:-9'),
        ])
        self.assertEqual(request_review(get_alloc(self.db_stages[0], self.db_studs[1])), dict())
        self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[2])), [
            dict(uri='template1.t.R:1:-7'),
            dict(uri='template1.t.R:1:-8'),
            dict(uri='template1.t.R:1:-9'),
        ])
        self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[3])), [
            dict(uri='template1.t.R:1:-7'),
            dict(uri='template1.t.R:1:-8'),
            dict(uri='template1.t.R:1:-9'),
        ])
        self.assertEqual(self.coins_awarded(self.db_studs[1]), 0)

        # student 0 can review student 1's work, we tell student 1 about it
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[0]), [
            aq_dict(uri='template1.t.R:1:-7', time_end=1130, student_answer=dict(choice="a2"), review=dict(comments="Absolutely **terrible**", content=-12, presentation=-12)),
            aq_dict(uri='template1.t.R:1:-8', time_end=1131, student_answer=dict(choice="a2"), review=dict(comments="*nice*", content=12, presentation=12)),
        ], 0)
        self.assertEqual(out[-2:], [
            aq_dict(uri='template1.t.R:1:-7', time_end=1130, student_answer=dict(choice="a2"), review=dict(comments="Absolutely **terrible**", content=-12, presentation=-12)),
            aq_dict(uri='template1.t.R:1:-8', time_end=1131, student_answer=dict(choice="a2"), review=dict(comments="*nice*", content=12, presentation=12)),
        ])
        self.assertEqual(additions, 2)
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[1]), [], 0)
        self.assertEqual(out, [
            aq_dict(uri='template1.t.R:1:1', time_end=1010, correct=None, mark=-8.0, student_answer=dict(text="2"), review=None, ug_reviews=[
                dict(comments='<p>Absolutely <strong>terrible</strong></p>', content=-12, presentation=-12, mark=-24),
            ]),
            aq_dict(uri='template1.t.R:1:1', time_end=1020, correct=None, mark=8.0, student_answer=dict(text="3"), review=None, ug_reviews=[
                dict(comments="<p><em>nice</em></p>", content=12, presentation=12, mark=24),
            ]),
            aq_dict(uri='template1.t.R:1:1', time_end=1030, correct=None, student_answer=dict(text="4"), review=None, ug_reviews=[]),
        ])

        # Test question updates - before we get version 1
        self.assertEqual(get_material(self.db_stages[0], self.db_studs[1]), [
            'template1.t.R:1:1',
        ])

        # Re-write questions mid-flow, doesn't affect question-writing / review
        self.mb_write_file('example1.q.R', b'''
# TW:TAGS=math099,Q-0990t0,lec050500,
# TW:PERMUTATIONS=10

question <- function(permutation, data_frames) { return(list(content = 'parp', correct = list())) }
        ''')
        self.mb_write_file('template1.t.R', b'''
# TW:TAGS=math099,Q-0990t0,lec050500,
# TW:PERMUTATIONS=1

question <- function(permutation, data_frames) { return(list(content = 'parp', correct = list())) }
        ''')
        self.mb_update()

        # Test question updates - after we get version 2
        self.assertEqual(get_material(self.db_stages[0], self.db_studs[1]), [
            'template1.t.R:2:1',
        ])
        # NB: In tests following we can still find and review version 1 questions

        # student 0 loses the ability to review 10 and 11, student 1 still gets no coins
        self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[0])), [
            dict(uri='template1.t.R:1:-9'),
        ])
        self.assertEqual(request_review(get_alloc(self.db_stages[0], self.db_studs[1])), dict())
        self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[2])), [
            dict(uri='template1.t.R:1:-7'),
            dict(uri='template1.t.R:1:-8'),
            dict(uri='template1.t.R:1:-9'),
        ])
        self.assertEqual(self.coins_awarded(self.db_studs[1]), 0)

        # student 2 gives similar reviews, pushes system over the edge to marking them
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[2]), [
            aq_dict(uri='template1.t.R:1:-7', time_end=1132, student_answer=dict(choice="a2"), review=dict(comments="Bad", content=-24, presentation=-300)),
            aq_dict(uri='template1.t.R:1:-8', time_end=1133, student_answer=dict(choice="a2"), review=dict(comments="Good", content=24, presentation=300)),
        ], 0)
        self.assertEqual(out[-2:], [
            aq_dict(uri='template1.t.R:1:-7', time_end=1132, student_answer=dict(choice="a2"), review=dict(comments="Bad", content=-24, presentation=-300)),
            aq_dict(uri='template1.t.R:1:-8', time_end=1133, student_answer=dict(choice="a2"), review=dict(comments="Good", content=24, presentation=300)),
        ])
        self.assertEqual(additions, 2)
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[1]), [], 0)
        self.assertEqual(out, [
            aq_dict(uri='template1.t.R:1:1', time_end=1010, correct=False, mark=-116.0, student_answer=dict(text="2"), review=None, ug_reviews=[
                dict(comments='<p>Absolutely <strong>terrible</strong></p>', content=-12, presentation=-12, mark=-24),
                dict(comments="<p>Bad</p>", content=-24, presentation=-300, mark=-324),
            ]),
            aq_dict(uri='template1.t.R:1:1', time_end=1020, correct=True, mark=116.0, student_answer=dict(text="3"), review=None, ug_reviews=[
                dict(comments="<p><em>nice</em></p>", content=12, presentation=12, mark=24),
                dict(comments="<p>Good</p>", content=24, presentation=300, mark=324),
            ]),
            aq_dict(uri='template1.t.R:1:1', time_end=1030, correct=None, student_answer=dict(text="4"), review=None, ug_reviews=[]),
        ])

        # Do this a few times to cope with random-ness
        for i in range(10):
            # student 2 loses the ability to review 10 and 11
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[0])), [
                dict(uri='template1.t.R:1:-9'),
            ])
            self.assertEqual(request_review(get_alloc(self.db_stages[0], self.db_studs[1])), dict())
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[2])), [
                dict(uri='template1.t.R:1:-9'),
            ])
            # Student 3 does too, since these are now marked
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[3])), [
                dict(uri='template1.t.R:1:-9'),
            ])
        # Student 1 awarded coins for their efforts
        self.assertEqual(self.coins_awarded(self.db_studs[1]), AWARD_UGMATERIAL_CORRECT)

        # Student 1 marks question as superseded, still gets review output for old
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[1]), [
            dict(client_id='01', uri='template1.t.R:1:1', time_start=1000, time_end=1010, correct=None, grade_after=0.1, student_answer=dict(text="2"), review=dict(superseded=True)),
        ], 0)
        self.assertEqual(out[0:1], [
            aq_dict(uri='template1.t.R:1:1', time_end=1010, correct=False, mark=-116, student_answer=dict(text="2"), review=dict(superseded=True), ug_reviews=[
                dict(comments='<p>Absolutely <strong>terrible</strong></p>', content=-12, presentation=-12, mark=-24),
                dict(comments="<p>Bad</p>", content=-24, presentation=-300, mark=-324),
            ]),
        ])

        # Student 1 skips a question (which is marked as False by the client), stays false
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[1]), [
            aq_dict(uri='template1.t.R:1:1', time_end=1040, correct=False, student_answer=dict(), review=dict()),
        ], 0)
        self.assertEqual(out[-1:], [
            aq_dict(uri='template1.t.R:1:1', time_end=1040, correct=False, student_answer=dict(), review=dict()),
        ])
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[1]), [
        ], 0)
        self.assertEqual(out[-1:], [
            aq_dict(uri='template1.t.R:1:1', time_end=1040, correct=False, student_answer=dict(), review=dict()),
        ])

        # Student 1 writes a version with new template
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[1]), [
            aq_dict(uri='template1.t.R:2:1', time_end=1210, correct=None, student_answer=dict(text="My new 2")),
        ], 0)
        self.assertEqual(out[-1:], [
            aq_dict(uri='template1.t.R:2:1', time_end=1210, correct=None, student_answer=dict(text="My new 2")),
        ])

        # ...no-one gets to review the skipped question, but can the new-template question
        for i in range(10):
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[0])), [
                dict(uri='template1.t.R:1:-9'),
                dict(uri='template1.t.R:2:-15'),
            ])
            self.assertEqual(request_review(get_alloc(self.db_stages[0], self.db_studs[1])), dict(
            ))
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[2])), [
                dict(uri='template1.t.R:1:-9'),
                dict(uri='template1.t.R:2:-15'),
            ])
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[3])), [
                dict(uri='template1.t.R:1:-9'),
                dict(uri='template1.t.R:2:-15'),
            ])

        # If we mark Student 3 as vetted, then the correct questions are also available, for all stages
        vetted_group = 'vetted.%s' % self.db_stages[1].syllabus.path[:-1]
        self.db_studs[3].groups.append(get_group(vetted_group, auto_create=True))
        DBSession.flush()
        for i in range(10):
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[0])), [
                dict(uri='template1.t.R:1:-9'),
                dict(uri='template1.t.R:2:-15'),
            ])
            self.assertEqual(
                request_review(get_alloc(self.db_stages[0], self.db_studs[1])),
                dict(),
            )
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[2])), [
                dict(uri='template1.t.R:1:-9'),
                dict(uri='template1.t.R:2:-15'),
            ])
            self.assertEqual(
                request_review(get_alloc(self.db_stages[0], self.db_studs[3])),
                dict(uri='template1.t.R:1:-8'),  # Just :-8 since this one is correct, and do correct ones first
            )

        # Student 3 gets special question, others don't.
        self.assertEqual(
            [x['name'] for x in stage_material(get_alloc(self.db_stages[0], self.db_studs[0]), ['template1.t.R:1:-9'])['data']['template1.t.R:1:-9']['review_questions']],
            ['content', 'presentation', 'difficulty'],
        )
        self.assertEqual(
            [x['name'] for x in stage_material(get_alloc(self.db_stages[0], self.db_studs[1]), ['template1.t.R:1:-9'])['data']['template1.t.R:1:-9']['review_questions']],
            ['content', 'presentation', 'difficulty'],
        )
        self.assertEqual(
            [x['name'] for x in stage_material(get_alloc(self.db_stages[0], self.db_studs[3]), ['template1.t.R:1:-9'])['data']['template1.t.R:1:-9']['review_questions']],
            ['vetted', 'content', 'presentation', 'difficulty'],
        )

        # If Student 3 reviews, then they get to review 12 again.
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[3]), [
            aq_dict(uri='template1.t.R:1:-8', time_end=1131, student_answer=dict(choice="a2"), review=dict(vetted=48, comments="Top, accepted into question bank", content=12, presentation=12)),
        ], 0)
        for i in range(10):
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[0])), [
                dict(uri='template1.t.R:1:-9'),
                dict(uri='template1.t.R:2:-15'),
            ])
            self.assertEqual(request_review(get_alloc(self.db_stages[0], self.db_studs[1])), dict(
            ))
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[2])), [
                dict(uri='template1.t.R:1:-9'),
                dict(uri='template1.t.R:2:-15'),
            ])
            self.assertIn(request_review(get_alloc(self.db_stages[0], self.db_studs[3])), [
                dict(uri='template1.t.R:1:-9'),
                dict(uri='template1.t.R:2:-15'),
            ])

        # Student 1 gets a major bonus thanks to the vetted review
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[1]), [], 0)
        self.assertEqual(out, [
            aq_dict(uri='template1.t.R:1:1', time_end=1010, correct=False, mark=-115, student_answer=dict(text="2"), review=dict(superseded=True), ug_reviews=[
                dict(comments='<p>Absolutely <strong>terrible</strong></p>', content=-12, presentation=-12, mark=-24),
                dict(comments="<p>Bad</p>", content=-24, presentation=-300, mark=-324),
            ]),
            aq_dict(uri='template1.t.R:1:1', time_end=1020, correct=True, mark=140, student_answer=dict(text="3"), review=None, ug_reviews=[
                dict(comments="<p><em>nice</em></p>", content=12, presentation=12, mark=24),
                # NB: This is reviewed earlier than the bottom one
                dict(comments="<p>Top, accepted into question bank</p>", vetted=48, content=12, presentation=12, mark=72),
                dict(comments="<p>Good</p>", content=24, presentation=300, mark=324),
            ]),
            aq_dict(uri='template1.t.R:1:1', time_end=1030, correct=None, student_answer=dict(text="4"), review=None, ug_reviews=[]),
            aq_dict(uri='template1.t.R:1:1', time_end=1040, correct=False, student_answer=dict(), review=dict()),
            aq_dict(uri='template1.t.R:2:1', time_end=1210, correct=None, student_answer=dict(text="My new 2")),
        ])
        self.assertEqual(self.coins_awarded(self.db_studs[1]), AWARD_UGMATERIAL_CORRECT + AWARD_UGMATERIAL_ACCEPTED)

        # The award stays static after being assigned once
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[1]), [], 0)
        self.assertEqual(self.coins_awarded(self.db_studs[1]), AWARD_UGMATERIAL_CORRECT + AWARD_UGMATERIAL_ACCEPTED)

        # We can still get student 0's work, after this diversion to student 1
        alloc = get_alloc(self.db_stages[0], self.db_studs[0])
        (out, additions) = sync_answer_queue(alloc, [
        ], 0)
        self.assertEqual(out, [
            aq_dict(uri='example1.q.R:1:6', time_start=1000, time_end=1005, time_offset=0, correct=True, grade_after=0.2, student_answer=dict(answer="3")),
            aq_dict(uri='example1.q.R:1:4', time_start=1000, time_end=1010, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2"), review=dict(hard="yes")),
            aq_dict(uri='example2.q.R:1:1', time_start=1000, time_end=1010, time_offset=300, correct=True, grade_after=0.1, student_answer=dict(answer="late")),
            aq_dict(uri='example1.q.R:1:7', time_start=1010, time_end=1015, time_offset=0, correct=True, grade_after=0.2, student_answer=dict(answer="3")),
            aq_dict(uri='example1.q.R:1:5', time_start=1010, time_end=1020, time_offset=0, correct=True, grade_after=0.1, student_answer=dict(answer="2")),
            aq_dict(uri='example1.q.R:1:8', time_start=1020, time_end=1025, time_offset=0, correct=True, grade_after=0.2, student_answer=dict(answer="3")),
            aq_dict(uri='template1.t.R:1:-7', time_end=1130, student_answer=dict(choice="a2"), review=dict(comments="Absolutely **terrible**", content=-12, presentation=-12)),
            aq_dict(uri='template1.t.R:1:-8', time_end=1131, student_answer=dict(choice="a2"), review=dict(comments="*nice*", content=12, presentation=12)),
        ])
        self.assertEqual(additions, 0)

        # ... and no work in second stage
        alloc = get_alloc(self.db_stages[1], self.db_studs[0])
        (out, additions) = sync_answer_queue(alloc, [
        ], 0)
        self.assertEqual(out, [
        ])
        self.assertEqual(additions, 0)

        # Student 0 works in second stage, not above answered rate, gets nothing (student 1 stays at same level)
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[1], self.db_studs[0]), [
            aq_dict(time_end=2000, uri='example1.q.R:1:1', grade_after=0.1),
            aq_dict(time_end=2001, uri='example1.q.R:1:1', grade_after=0.1),
            aq_dict(time_end=2002, uri='example1.q.R:1:1', grade_after=0.1),
        ], 0)
        self.assertEqual(out, [
            aq_dict(time_end=2000, uri='example1.q.R:1:1', grade_after=0.1),
            aq_dict(time_end=2001, uri='example1.q.R:1:1', grade_after=0.1),
            aq_dict(time_end=2002, uri='example1.q.R:1:1', grade_after=0.1),
        ])
        self.assertEqual(self.coins_awarded(self.db_studs[0]), 0)
        self.assertEqual(self.coins_awarded(self.db_studs[1]), AWARD_UGMATERIAL_CORRECT + AWARD_UGMATERIAL_ACCEPTED)

        # Student 1 gets answered award (student 1 stays at same level)
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[1], self.db_studs[0]), [
            aq_dict(time_end=2003, uri='example1.q.R:1:1', grade_after=4.5),
            aq_dict(time_end=2004, uri='example1.q.R:1:1', grade_after=5.5),
            aq_dict(time_end=2005, uri='example1.q.R:1:1', grade_after=5.5),
        ], 0)
        self.assertEqual(out[-3:], [
            aq_dict(time_end=2003, uri='example1.q.R:1:1', grade_after=4.5),
            aq_dict(time_end=2004, uri='example1.q.R:1:1', grade_after=5.5),
            aq_dict(time_end=2005, uri='example1.q.R:1:1', grade_after=5.5),
        ])
        self.assertEqual(self.coins_awarded(self.db_studs[0]), AWARD_STAGE_ANSWERED)
        self.assertEqual(self.coins_awarded(self.db_studs[1]), AWARD_UGMATERIAL_CORRECT + AWARD_UGMATERIAL_ACCEPTED)

        # Upgrade stage, still get results since we fetch from previous
        old_stage_id = self.db_stages[1].stage_id
        self.db_stages[1] = self.upgrade_stage(self.db_stages[1], dict(
            upgraded=dict(value="1"),
        ))
        self.assertNotEqual(old_stage_id, self.db_stages[1].stage_id)

        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[1], self.db_studs[0]), [
        ], 0)
        self.assertEqual(len(out), 6)

        # Student 1 improves a little bit, no more awards
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[1], self.db_studs[0]), [
            aq_dict(time_end=2006, uri='example1.q.R:1:1', grade_after=6.5),
            aq_dict(time_end=2007, uri='example1.q.R:1:1', grade_after=7.5),
            aq_dict(time_end=2008, uri='example1.q.R:1:1', grade_after=8.5),
        ], 0)
        self.assertEqual(out[-3:], [
            aq_dict(time_end=2006, uri='example1.q.R:1:1', grade_after=6.5),
            aq_dict(time_end=2007, uri='example1.q.R:1:1', grade_after=7.5),
            aq_dict(time_end=2008, uri='example1.q.R:1:1', grade_after=8.5),
        ])
        self.assertEqual(self.coins_awarded(self.db_studs[0]), AWARD_STAGE_ANSWERED)
        self.assertEqual(self.coins_awarded(self.db_studs[1]), AWARD_UGMATERIAL_CORRECT + AWARD_UGMATERIAL_ACCEPTED)

        # Student 1 repeatedly aces, but only gets aced award once
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[1], self.db_studs[0]), [
            aq_dict(time_end=2009, uri='example1.q.R:1:1', grade_after=9.9),
            aq_dict(time_end=2010, uri='example1.q.R:1:1', grade_after=9.9),
            aq_dict(time_end=2011, uri='example1.q.R:1:1', grade_after=9.9),
        ], 0)
        self.assertEqual(out[-3:], [
            aq_dict(time_end=2009, uri='example1.q.R:1:1', grade_after=9.9),
            aq_dict(time_end=2010, uri='example1.q.R:1:1', grade_after=9.9),
            aq_dict(time_end=2011, uri='example1.q.R:1:1', grade_after=9.9),
        ])
        self.assertEqual(self.coins_awarded(self.db_studs[0]), AWARD_STAGE_ANSWERED + AWARD_STAGE_ACED)
        self.assertEqual(self.coins_awarded(self.db_studs[1]), AWARD_UGMATERIAL_CORRECT + AWARD_UGMATERIAL_ACCEPTED)

        # Upgrade stage again, we still get award even though these results are in the past
        old_stage_id = self.db_stages[1].stage_id
        self.db_stages[1] = self.upgrade_stage(self.db_stages[1], dict(
            upgraded=dict(value="1"),
        ))
        self.assertNotEqual(old_stage_id, self.db_stages[1].stage_id)

        # Ace other 2 stages, get stage awards but not the big prize
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[0], self.db_studs[0]), [
            aq_dict(time_end=2012, uri='example1.q.R:1:1', grade_after=9.92),
        ], 0)
        self.assertEqual(self.coins_awarded(self.db_studs[0]), 2 * (AWARD_STAGE_ANSWERED + AWARD_STAGE_ACED))
        (out, additions) = sync_answer_queue(get_alloc(self.db_stages[2], self.db_studs[0]), [
            aq_dict(time_end=2013, uri='example1.q.R:1:1', grade_after=9.93),
        ], 0)
        self.assertEqual(self.coins_awarded(self.db_studs[0]), 3 * (AWARD_STAGE_ANSWERED + AWARD_STAGE_ACED))

        # Ace final stage in second lecture, get the full award
        (out, additions) = sync_answer_queue(get_alloc(self.db_other_stages[0], self.db_studs[0]), [
            aq_dict(time_end=2013, uri='example1.q.R:1:1', grade_after=9.94),
        ], 0)
        self.assertEqual(self.coins_awarded(self.db_studs[0]), 4 * (AWARD_STAGE_ANSWERED + AWARD_STAGE_ACED) + AWARD_TUTORIAL_ACED)

        # Check result summary for everything
        out = list(result_summary())
        self.assertEqual(sorted(out[0][1:]), out[0][1:])  # Columns sorted
        out_dict = [dict((k, str(row[i])) for i, k in enumerate(out[0])) for row in out[1:]]
        self.assertEqual(out_dict, [
            {
                'student': 'user0',
                str(self.db_other_stages[0].syllabus.path + 'stage0'): '9.940',
                str(self.db_stages[0].syllabus.path + 'stage0'): '9.920',
                str(self.db_stages[0].syllabus.path + 'stage1'): '9.900',
                str(self.db_stages[0].syllabus.path + 'stage2'): '9.930',
            }, {
                'student': 'user1',
                str(self.db_other_stages[0].syllabus.path + 'stage0'): '0',
                str(self.db_stages[0].syllabus.path + 'stage0'): '0.100',
                str(self.db_stages[0].syllabus.path + 'stage1'): '0',
                str(self.db_stages[0].syllabus.path + 'stage2'): '0',
            }, {
                'student': 'user2',
                str(self.db_other_stages[0].syllabus.path + 'stage0'): '0',
                str(self.db_stages[0].syllabus.path + 'stage0'): '0.100',
                str(self.db_stages[0].syllabus.path + 'stage1'): '0',
                str(self.db_stages[0].syllabus.path + 'stage2'): '0',
            }, {
                'student': 'user3',
                str(self.db_other_stages[0].syllabus.path + 'stage0'): '0',
                str(self.db_stages[0].syllabus.path + 'stage0'): '0.100',
                str(self.db_stages[0].syllabus.path + 'stage1'): '0',
                str(self.db_stages[0].syllabus.path + 'stage2'): '0',
            }
        ])

        # Just for db_other_stages[0]
        out = list(result_summary(self.db_other_stages[0].syllabus.path))
        self.assertEqual(sorted(out[0][1:]), out[0][1:])  # Columns sorted
        out_dict = [dict((k, str(row[i])) for i, k in enumerate(out[0])) for row in out[1:]]
        self.assertEqual(out_dict, [
            {
                'student': 'user0',
                'stage0': '9.940',
            }
        ])

        # Check full results
        out = list(result_full())
        from tutorweb_quizdb.timestamp import timestamp_to_datetime

        # Check other stage first, depending on it's value it will either be at the beginning or the end of the list
        if str(self.db_other_stages[0].syllabus.path) < str(self.db_stages[0].syllabus.path):
            self.assertEqual(out[1:2], [
                (str(self.db_other_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('9.940'), timestamp_to_datetime(2013)),
            ])
            del out[1]
        else:
            self.assertEqual(out[-1:], [
                (str(self.db_other_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('9.940'), timestamp_to_datetime(2013)),
            ])
            del out[-1]

        # Check rest of values, should be in user/time order
        self.assertEqual(out, [
            ['lecture', 'stage', 'stage version', 'student', 'correct', 'grade', 'time'],
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('0.200'), timestamp_to_datetime(1005)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('0.100'), timestamp_to_datetime(1010)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('0.100'), timestamp_to_datetime(1010)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('0.200'), timestamp_to_datetime(1015)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('0.100'), timestamp_to_datetime(1020)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('0.200'), timestamp_to_datetime(1025)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('0.100'), timestamp_to_datetime(1130)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('0.100'), timestamp_to_datetime(1131)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user0', True, Decimal('9.920'), timestamp_to_datetime(2012)),

            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user1', False, Decimal('0.100'), timestamp_to_datetime(1010)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user1', True, Decimal('0.100'), timestamp_to_datetime(1020)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user1', None, Decimal('0.100'), timestamp_to_datetime(1030)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user1', False, Decimal('0.100'), timestamp_to_datetime(1040)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user1', None, Decimal('0.100'), timestamp_to_datetime(1210)),

            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user2', True, Decimal('0.100'), timestamp_to_datetime(1132)),
            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user2', True, Decimal('0.100'), timestamp_to_datetime(1133)),

            (str(self.db_stages[0].syllabus.path), 'stage0', 1, 'user3', True, Decimal('0.100'), timestamp_to_datetime(1131)),

            (str(self.db_stages[0].syllabus.path), 'stage1', 1, 'user0', True, Decimal('0.100'), timestamp_to_datetime(2000)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 1, 'user0', True, Decimal('0.100'), timestamp_to_datetime(2001)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 1, 'user0', True, Decimal('0.100'), timestamp_to_datetime(2002)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 1, 'user0', True, Decimal('4.500'), timestamp_to_datetime(2003)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 1, 'user0', True, Decimal('5.500'), timestamp_to_datetime(2004)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 1, 'user0', True, Decimal('5.500'), timestamp_to_datetime(2005)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 2, 'user0', True, Decimal('6.500'), timestamp_to_datetime(2006)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 2, 'user0', True, Decimal('7.500'), timestamp_to_datetime(2007)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 2, 'user0', True, Decimal('8.500'), timestamp_to_datetime(2008)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 2, 'user0', True, Decimal('9.900'), timestamp_to_datetime(2009)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 2, 'user0', True, Decimal('9.900'), timestamp_to_datetime(2010)),
            (str(self.db_stages[0].syllabus.path), 'stage1', 2, 'user0', True, Decimal('9.900'), timestamp_to_datetime(2011)),

            (str(self.db_stages[0].syllabus.path), 'stage2', 1, 'user0', True, Decimal('9.930'), timestamp_to_datetime(2013)),
        ])

        # The view version requires admin permissions
        with self.assertRaisesRegex(HTTPForbidden, 'admin'):
            view_syllabus_results(self.request(
                user=self.db_studs[0],
                params=dict(path=str(self.db_stages[0].syllabus.path)),
            ))

        # Add admin permissions, now the same as result_summary
        self.db_studs[0].groups.append(get_group('admin.%s' % self.db_stages[0].syllabus.path, auto_create=True))
        self.assertEqual(view_syllabus_results(self.request(
            user=self.db_studs[0],
            params=dict(path=str(self.db_stages[0].syllabus.path)),
        ))['results'], list(result_summary(str(self.db_stages[0].syllabus.path))))

        # Can't get at the other stages though, without that permission
        with self.assertRaisesRegex(HTTPForbidden, 'admin'):
            view_syllabus_results(self.request(
                user=self.db_studs[0],
                params=dict(path=str(self.db_other_stages[0].syllabus.path)),
            ))
        self.db_studs[0].groups.append(get_group('admin.%s' % self.db_other_stages[0].syllabus.path, auto_create=True))
        self.assertEqual(view_syllabus_results(self.request(
            user=self.db_studs[0],
            params=dict(path=str(self.db_other_stages[0].syllabus.path)),
        ))['results'], list(result_summary(str(self.db_other_stages[0].syllabus.path))))
