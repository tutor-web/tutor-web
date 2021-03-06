import unittest

from sqlalchemy_utils import Ltree

from .requires_postgresql import RequiresPostgresql
from .requires_pyramid import RequiresPyramid

from tutorweb_quizdb.student.create import create_student
from tutorweb_quizdb.subscriptions.index import add_syllabus, subscription_add, subscription_remove, view_subscription_list
from tutorweb_quizdb.subscriptions.available import view_subscription_available


class AddSyllabusTest(unittest.TestCase):
    maxDiff = None

    def test_withsamename(self):
        """Adding items at same level with same name shouldn't cause a problem"""
        out_root = dict(children=[])

        add_syllabus(out_root, Ltree('math.101.0'), dict(title='hi'), 2)
        add_syllabus(out_root, Ltree('math.101.0.1'), dict(title='hi l1'), 2)
        add_syllabus(out_root, Ltree('math.101.0.2'), dict(title='hi l2'), 2)
        add_syllabus(out_root, Ltree('math.612.0'), dict(title='hello'), 2)
        add_syllabus(out_root, Ltree('math.612.0.1'), dict(title='hello 1'), 2)
        self.assertEqual(out_root, dict(children=[
            {
                'path': Ltree('math.101.0'), 'title': 'hi',
                'children': [
                    {'path': Ltree('math.101.0.1'), 'title': 'hi l1', 'children': []},
                    {'path': Ltree('math.101.0.2'), 'title': 'hi l2', 'children': []},
                ]
            },
            {
                'path': Ltree('math.612.0'), 'title': 'hello',
                'children': [
                    {'path': Ltree('math.612.0.1'), 'title': 'hello 1', 'children': []},
                ]
            },
        ]))


class SubscriptionsListTest(RequiresPyramid, RequiresPostgresql, unittest.TestCase):
    maxDiff = None

    def setUp(self):
        super(SubscriptionsListTest, self).setUp()

        from tutorweb_quizdb import DBSession, Base, ACTIVE_HOST
        self.DBSession = DBSession

        lecture_paths = [
            'dept0',
            'dept0.tut0',
            'dept0.tut0.lec0',
            'dept0.tut0.lec1',
            'dept0.tut1',
            'dept0.tut1.lec0',
            'dept0.tut1.lec1',
            'dept1',
            'dept1.tut2',
            'dept1.tut2.lec0',
            'dept1.tut2.lec1',
        ]

        # Add lectures
        self.db_lecs = {}
        for l in lecture_paths:
            self.db_lecs[l] = Base.classes.syllabus(host_id=ACTIVE_HOST, path=Ltree(l), title="UT Lecture %s" % l)
            DBSession.add(self.db_lecs[l])
        self.db_lecs['dept0.tut0.lec0'].supporting_material_href = 'http://wikipedia.org/'
        DBSession.flush()

        # Hang some stages off lectures
        self.db_stages = {}
        for l in lecture_paths:
            if '.lec' not in l:
                continue
            self.db_stages[l] = Base.classes.stage(
                syllabus=self.db_lecs[l],
                stage_name='stage0',
                version=0,
                title='UT stage %s.stage0' % l,
                stage_setting_spec=dict(
                    allocation_method=dict(value='passthrough'),
                ),
            )
            DBSession.add(self.db_stages[l])
        DBSession.flush()

        # Add some students
        self.db_studs = self.create_students(
            3,
            student_group_fn=lambda i: ['accept_terms', 'super_secret', 'admin.dept0.tut1.lec1'] if i == 0 else ['accept_terms']
        )

    def test_call(self):
        from tutorweb_quizdb import DBSession

        # make some subscriptions
        subscription_add(self.db_studs[0], Ltree('dept0.tut0'))
        subscription_add(self.db_studs[0], Ltree('dept0.tut1.lec1'))
        subscription_add(self.db_studs[1], Ltree('dept0.tut1'))
        DBSession.flush()

        out0_pre_secret = view_subscription_list(self.request(user=self.db_studs[0]))
        self.assertEqual(out0_pre_secret, {'children': [
            {
                'path': Ltree('dept0.tut0'),
                'title': 'UT Lecture dept0.tut0',
                'can_admin': False,
                'children': [
                    {
                        'path': Ltree('dept0.tut0.lec0'),
                        'title': 'UT Lecture dept0.tut0.lec0',
                        'can_admin': False,
                        'supporting_material_href': 'http://wikipedia.org/',
                        'children': [
                            {
                                'href': '/api/stage?path=dept0.tut0.lec0.stage0',
                                'stage': 'stage0',
                                'title': 'UT stage dept0.tut0.lec0.stage0'
                            },
                        ],
                    }, {
                        'path': Ltree('dept0.tut0.lec1'),
                        'title': 'UT Lecture dept0.tut0.lec1',
                        'can_admin': False,
                        'children': [
                            {
                                'href': '/api/stage?path=dept0.tut0.lec1.stage0',
                                'stage': 'stage0',
                                'title': 'UT stage dept0.tut0.lec1.stage0'
                            },
                        ],
                    }
                ]
            },
            {
                'path': Ltree('dept0.tut1.lec1'),
                'title': 'UT Lecture dept0.tut1.lec1',
                'can_admin': True,  # NB: user0 can admin this
                'children': [
                    {
                        'href': '/api/stage?path=dept0.tut1.lec1.stage0',
                        'stage': 'stage0',
                        'title': 'UT stage dept0.tut1.lec1.stage0',
                    }
                ],
            }
        ]})

        out = view_subscription_list(self.request(user=self.db_studs[1]))
        self.assertEqual(out, {'children': [
            {
                'path': Ltree('dept0.tut1'),
                'title': 'UT Lecture dept0.tut1',
                'can_admin': False,
                'children': [
                    {
                        'path': Ltree('dept0.tut1.lec0'),
                        'title': 'UT Lecture dept0.tut1.lec0',
                        'can_admin': False,
                        'children': [
                            {
                                'href': '/api/stage?path=dept0.tut1.lec0.stage0',
                                'stage': 'stage0',
                                'title': 'UT stage dept0.tut1.lec0.stage0'
                            },
                        ],
                    }, {
                        'path': Ltree('dept0.tut1.lec1'),
                        'title': 'UT Lecture dept0.tut1.lec1',
                        'can_admin': False,  # NB: user1 can't admin this
                        'children': [
                            {
                                'href': '/api/stage?path=dept0.tut1.lec1.stage0',
                                'stage': 'stage0',
                                'title': 'UT stage dept0.tut1.lec1.stage0'
                            },
                        ],
                    }
                ]
            },
        ]})

        # Try adding a more specific lecture. This should be picked up and ignored
        subscription_add(self.db_studs[1], Ltree('dept0.tut1.lec1'))
        DBSession.flush()
        out = view_subscription_list(self.request(user=self.db_studs[1]))
        self.assertEqual(out, {'children': [
            {
                'path': Ltree('dept0.tut1'),
                'title': 'UT Lecture dept0.tut1',
                'can_admin': False,
                'children': [
                    {
                        'path': Ltree('dept0.tut1.lec0'),
                        'title': 'UT Lecture dept0.tut1.lec0',
                        'can_admin': False,
                        'children': [
                            {
                                'href': '/api/stage?path=dept0.tut1.lec0.stage0',
                                'stage': 'stage0',
                                'title': 'UT stage dept0.tut1.lec0.stage0'
                            },
                        ],
                    }, {
                        'path': Ltree('dept0.tut1.lec1'),
                        'title': 'UT Lecture dept0.tut1.lec1',
                        'can_admin': False,  # NB: user1 can't admin this
                        'children': [
                            {
                                'href': '/api/stage?path=dept0.tut1.lec1.stage0',
                                'stage': 'stage0',
                                'title': 'UT stage dept0.tut1.lec1.stage0'
                            },
                        ],
                    }
                ]
            },
        ]})

        # Make dept0.tut1.lec1 super-secret, only stud0 can see it
        self.db_lecs['dept0.tut1.lec1'].requires_group_id = [g.id for g in self.db_studs[0].groups if g.name == 'super_secret'][0]
        DBSession.flush()

        out0_post_secret = view_subscription_list(self.request(user=self.db_studs[0]))
        self.assertEqual(out0_post_secret, out0_pre_secret)

        out = view_subscription_list(self.request(user=self.db_studs[1]))
        self.assertEqual(out, {'children': [
            {
                'path': Ltree('dept0.tut1'),
                'title': 'UT Lecture dept0.tut1',
                'can_admin': False,
                'children': [
                    {
                        'path': Ltree('dept0.tut1.lec0'),
                        'title': 'UT Lecture dept0.tut1.lec0',
                        'can_admin': False,
                        'children': [
                            {
                                'href': '/api/stage?path=dept0.tut1.lec0.stage0',
                                'stage': 'stage0',
                                'title': 'UT stage dept0.tut1.lec0.stage0'
                            },
                        ],
                    }
                ]
            },
        ]})

        # Repeatedly adding isn't a problem
        subscription_add(self.db_studs[0], Ltree('dept0.tut0'))
        subscription_add(self.db_studs[0], Ltree('dept0.tut1.lec1'))
        subscription_add(self.db_studs[1], Ltree('dept0.tut1'))
        DBSession.flush()

        # Remove subscription from dept0.tut1.lec1, it disappears
        subscription_remove(self.db_studs[0], Ltree('dept0.tut1.lec1'))
        out = view_subscription_list(self.request(user=self.db_studs[0]))
        self.assertEqual(out, {'children': [
            {
                'path': Ltree('dept0.tut0'),
                'title': 'UT Lecture dept0.tut0',
                'can_admin': False,
                'children': [
                    {
                        'path': Ltree('dept0.tut0.lec0'),
                        'title': 'UT Lecture dept0.tut0.lec0',
                        'can_admin': False,
                        'supporting_material_href': 'http://wikipedia.org/',
                        'children': [
                            {
                                'href': '/api/stage?path=dept0.tut0.lec0.stage0',
                                'stage': 'stage0',
                                'title': 'UT stage dept0.tut0.lec0.stage0'
                            },
                        ],
                    }, {
                        'path': Ltree('dept0.tut0.lec1'),
                        'title': 'UT Lecture dept0.tut0.lec1',
                        'can_admin': False,
                        'children': [
                            {
                                'href': '/api/stage?path=dept0.tut0.lec1.stage0',
                                'stage': 'stage0',
                                'title': 'UT stage dept0.tut0.lec1.stage0'
                            },
                        ],
                    }
                ]
            },
        ]})

        # Still available though
        out = view_subscription_available(self.request(user=self.db_studs[0]))
        self.assertEqual(out, {'children': [
            {
                'path': Ltree('dept0'),
                'subscribed': None,
                'supporting_material_href': None,
                'title': 'UT Lecture dept0',
                'can_admin': False,
                'children': [
                    {
                        'path': Ltree('dept0.tut0'),
                        'subscribed': Ltree('dept0.tut0'),
                        'supporting_material_href': None,
                        'title': 'UT Lecture dept0.tut0',
                        'can_admin': False,
                        'children': [
                            {
                                'path': Ltree('dept0.tut0.lec0'),
                                'subscribed': Ltree('dept0.tut0'),  # NB: This is the root of our subscription
                                'supporting_material_href': 'http://wikipedia.org/',
                                'title': 'UT Lecture dept0.tut0.lec0',
                                'can_admin': False,
                                'children': [],
                            }, {
                                'path': Ltree('dept0.tut0.lec1'),
                                'subscribed': Ltree('dept0.tut0'),  # NB: This is the root of our subscription
                                'supporting_material_href': None,
                                'title': 'UT Lecture dept0.tut0.lec1',
                                'can_admin': False,
                                'children': [],
                            },
                        ],
                    }, {
                        'path': Ltree('dept0.tut1'),
                        'subscribed': None,
                        'supporting_material_href': None,
                        'title': 'UT Lecture dept0.tut1',
                        'can_admin': False,
                        'children': [
                            {
                                'path': Ltree('dept0.tut1.lec0'),
                                'subscribed': None,
                                'supporting_material_href': None,
                                'title': 'UT Lecture dept0.tut1.lec0',
                                'can_admin': False,
                                'children': [],
                            }, {
                                'path': Ltree('dept0.tut1.lec1'),
                                'subscribed': None,
                                'supporting_material_href': None,
                                'title': 'UT Lecture dept0.tut1.lec1',
                                'can_admin': True,  # NB: user0 can admin this
                                'children': [],
                            },
                        ],
                    },
                ],
            }, {
                'path': Ltree('dept1'),
                'subscribed': None,
                'supporting_material_href': None,
                'title': 'UT Lecture dept1',
                'can_admin': False,
                'children': [
                    {
                        'path': Ltree('dept1.tut2'),
                        'subscribed': None,
                        'supporting_material_href': None,
                        'title': 'UT Lecture dept1.tut2',
                        'can_admin': False,
                        'children': [
                            {
                                'path': Ltree('dept1.tut2.lec0'),
                                'subscribed': None,
                                'supporting_material_href': None,
                                'title': 'UT Lecture dept1.tut2.lec0',
                                'can_admin': False,
                                'children': [],
                            }, {
                                'path': Ltree('dept1.tut2.lec1'),
                                'subscribed': None,
                                'supporting_material_href': None,
                                'title': 'UT Lecture dept1.tut2.lec1',
                                'can_admin': False,
                                'children': [],
                            },
                        ]
                    }
                ],
            }
        ]})

        # TODO: Test subscription_add (should be a separate tests, but DB setup goes bang)
        from pyramid.httpexceptions import HTTPNotFound

        stage = self.create_stages(1, requires_group='ut.requires_group')[0]
        stud, password = create_student(self.request(), 'user_test_subscription_add', assign_password=True)
        self.assertEqual([g.name for g in stud.groups], [])

        # Ignore any attempts to add to something we're not part of by default
        # Can't add to something we're not part of
        with self.assertRaisesRegex(HTTPNotFound, str(stage.syllabus.path)):
            subscription_add(stud, stage.syllabus.path)

        subscription_add(stud, stage.syllabus.path, add_to_group=True)
        self.assertEqual([g.name for g in stud.groups], ['ut.requires_group'])
