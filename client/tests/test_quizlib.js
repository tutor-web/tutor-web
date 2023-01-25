"use strict";
/*jslint nomen: true, plusplus: true, unparam: true, todo: true*/
/*global Set*/
var test = require('tape');

var Quiz = require('../lib/quizlib.js');
var JSONLocalStorage = require('../lib/jsonls');
var tk = require('timekeeper');
var Promise = require('es6-promise').Promise;
var LZString = require('lz-string');

function broken_test(name, fn) {
    return fn;
}

function MockLocalStorage() {
    this.obj = {};
    this.length = 0;

    this.removeItem = function (key) {
        this.length--;
        return delete this.obj[key];
    };

    this.getItem = function (key) {
        var value = this.obj[key];
        return value === undefined ? null : value;
    };

    this.getParsedItem = function (key) {
        var jsonls = new JSONLocalStorage(this);
        return jsonls.getItem(key);
    };

    this.setItem = function (key, value) {
        if (!this.obj.hasOwnProperty(key)) {
            this.length++;
        }
        this.obj[key] = value;
        return value;
    };

    this.key = function (i) {
        return Object.keys(this.obj)[i];
    };
}

function MockAjaxApi() {
    this.count = 0;
    this.responses = {};
    this.data = {};
    this.cached = {};

    this.getHtml = function (uri) {
        return this.block('GET ' + uri, undefined);
    };

    this.getJson = function (uri) {
        return this.block('GET ' + uri, undefined);
    };

    this.postJson = function (uri, data) {
        return this.block('POST ' + uri, data);
    };

    this.getCachedJson = function (uri, timeout) {
        if (this.cached[uri] !== undefined) {
            return Promise.resolve(this.cached[uri]);
        }
        return this.block('GET ' + uri, undefined).then(function (resp) {
            this.cached[uri] = resp;
            return resp;
        }.bind(this));
    };

    this.injectCache = function (uri, ret) {
        this.cached[uri] = ret;
    };

    this.listCached = function () {
        return new Set(Object.keys(this.cached));
    };

    this.removeUnusedCache = function (expected_uris) {
        // NB: We don't need to convert uris, but we do need to Set-ify the input
        var expected_full_uris = new Set(expected_uris);

        return Promise.all(Object.keys(this.cached).filter(function (uri) {
            return !expected_full_uris.has(uri);
        }.bind(this)).map(function (uri) {
            var out = this.cached.hasOwnProperty(uri);
            delete this.cached[uri];
            return out;
        }.bind(this)));
    };

    this.ajax = function (call) {
        return this.block(call.type + ' ' + call.url, undefined);
    };

    /** Block until responses[method + count] contains something to resolve to */
    this.block = function (method, data) {
        var self = this,
            timerTick = 10,
            waited = 0,
            promiseId = [method, this.count++].join(' ');
        //console.trace(promiseId);
        self.responses[promiseId] = undefined;
        this.data[promiseId] = data;

        return new Promise(function (resolve, reject) {
            setTimeout(function tick() {
                var r = self.responses[promiseId];
                if (r === undefined) {
                    if (waited++ < 10) {
                        setTimeout(tick, timerTick);
                        return;
                    }
                    r = new Error("MockAjaxApi Timeout: " + promiseId + ' [' + Object.keys(self.responses).filter(function (x) {
                        // Undefined promises are just a flag that we're blocking, not a valid response
                        return self.responses[x] !== undefined;
                    }) + ']');
                }

                delete self.responses[promiseId];
                delete self.data[promiseId];
                if (r instanceof Error) {
                    reject(r);
                } else {
                    resolve(r);
                }
            }, timerTick);
        });
    };

    this.getQueue = function () {
        return Object.keys(this.responses);
    };

    this.waitForQueue = function (expectedResponses) {
        var self = this,
            waited = 0;

        function allEqual(a, b) {
            var i;

            if (a.length !== b.length) {
                return false;
            }

            for (i = 0; i < a.length; i++) {
                if (a[i] !== b[i]) {
                    return false;
                }
            }
            return true;
        }

        return new Promise(function pollQueue(resolve, reject) {
            if (allEqual(Object.keys(self.responses), expectedResponses)) {
                resolve(self.responses);
            } else if (waited > 10) {
                console.log(self);
                console.log(expectedResponses);
                reject(self.responses);
            } else {
                waited++;
                setTimeout(pollQueue.bind(null, resolve, reject), 5);
            }
        });
    };

    this.setResponse = function (method, promiseCount, ret) {
        if (ret === undefined) {
            throw new Error("undefined responses are not supported");
        }
        this.responses[method + ' ' + promiseCount] = ret;
        return ret;
    };
}

function getQn(quiz, practiceMode) {
    return quiz.getNewQuestion({practice: practiceMode});
}
function setAns(quiz, choice) {
    return quiz.setQuestionAnswer(
        typeof choice === "object" ? choice
            : {"answer": choice}
    );
}
function setCurLec(quiz, tutUri, lecUri) {
    return quiz.setCurrentLecture({
        lecUri: lecUri,
    });
}
function insertTutorial(quiz, tutId, tutTitle, lectures, questions) {
    return quiz.insertTutorial(tutId, tutTitle, lectures, questions);
}
function newTutorial(quiz, tut_uri, extra_settings, question_counts) {
    var question_objects = {},
        settings = { "hist_sel": '0' };

    Object.keys(extra_settings || {}).map(function (k) {
        settings[k] = extra_settings[k];
    });

    return insertTutorial(quiz, tut_uri, 'UT tutorial', question_counts.map(function (question_count, lec_i) {
        // Make an array (question_count) elements long
        var x_long_arr = [];
        x_long_arr.length = question_count;
        x_long_arr = Array.apply(null, x_long_arr);

        return {
            "answerQueue": [],
            "questions": x_long_arr.map(function (ignore, qn_i) {
                var qn_uri = tut_uri + ":lec" + lec_i + ":qn" + qn_i;

                question_objects[qn_uri] = {
                    "text": '<div>The symbol for the set of all irrational numbers is... (a)</div>',
                    "choices": [
                        '<div>$\\mathbb{R} \\backslash \\mathbb{Q}$ (me)</div>',
                        '<div>$\\mathbb{Q} \\backslash \\mathbb{R}$</div>',
                        '<div>$\\mathbb{N} \\cap \\mathbb{Q}$</div>' ],
                    "shuffle": [0, 1, 2],
                    "correct": { "answer": [0] },
                    "answer": {
                        "explanation": "<div>\nThe symbol for the set of all irrational numbers (a)\n</div>",
                    }
                };

                return { "uri": qn_uri, "chosen": qn_i * 20, "correct": 100 };
            }),
            "settings": settings,
            "uri": tut_uri + ":lec" + lec_i,
            "material_uri": tut_uri + ":lec" + lec_i + ":all-questions",
        };
    }), question_objects);
}

// Find the first answer in qn that is correct
function chooseAnswer(args, correct) {
    var i;
    for (i = 0; i < args.qn.choices.length; i++) {
        if (args.qn.choices[i].indexOf('(me)') > -1) {
            if (correct) {
                return { answer: i };
            }
        } else {
            if (!correct) {
                return { answer: i };
            }
        }
    }
    throw "No suitable answer";
}


function test_utils() {
    var utils = {};

    utils.utTutorial = { "title": "UT tutorial", "lectures": []};

    utils.utTutorial.lectures.push({
        "answerQueue": [],
        "questions": [
            {"uri": "ut:question0", "chosen": 20, "correct": 100},
            {"uri": "ut:question1", "chosen": 40, "correct": 100},
            {"uri": "ut:question2", "chosen": 60, "correct": 100},
        ],
        "settings": {
            "hist_sel": 0,
        },
        "uri": "ut:lecture0",
        "material_uri": "ut:lecture0:all-questions",
    });

    utils.utQuestions = {
        "ut:question0" : {
            "text": '<div>The symbol for the set of all irrational numbers is... (a)</div>',
            "choices": [
                '<div>$\\mathbb{R} \\backslash \\mathbb{Q}$ (me)</div>',
                '<div>$\\mathbb{Q} \\backslash \\mathbb{R}$</div>',
                '<div>$\\mathbb{N} \\cap \\mathbb{Q}$</div>' ],
            "shuffle": [0, 1, 2],
            "correct": { answer: [0] },
            "answer": {
                "explanation": "<div>\nThe symbol for the set of all irrational numbers (a)\n</div>",
            }
        },
        "ut:question1" : {
            "text": '<div>The symbol for the set of all irrational numbers is... (b)</div>',
            "choices": [
                '<div>$\\mathbb{R} \\backslash \\mathbb{Q}$ (me)</div>',
                '<div>$\\mathbb{Q} \\backslash \\mathbb{R}$</div>',
                '<div>$\\mathbb{N} \\cap \\mathbb{Q}$ (me)</div>' ],
            "shuffle": [0, 1],
            "correct": { answer: [0, 2] },
            "answer": {
                "explanation": "<div>\nThe symbol for the set of all irrational numbers (b)\n</div>",
            }
        },
        "ut:question2" : {
            "text": '<div>The symbol for the set of all irrational numbers is... (c)</div>',
            "choices": [
                '<div>$\\mathbb{R} \\backslash \\mathbb{Q} (me)$</div>',
                '<div>$\\mathbb{Q} \\backslash \\mathbb{R}$</div>',
                '<div>$\\mathbb{N} \\cap \\mathbb{Q}$</div>' ],
            "shuffle": [0, 1, 2],
            "correct": { answer: [0] },
            "answer": {
                "explanation": "<div>\nThe symbol for the set of all irrational numbers (c)\n</div>",
            }
        },
    };

    utils.question = function (uri, data) {
        var answer = Math.floor(Math.random() * 100000).toString();

        return Object.assign({}, {
            uri: uri,
            content: [
                '<div>',
                '<pre>' + uri + '</pre>',
                '</div>',
            ].join('\n'),
            correct: {answer: answer},
            tags: ["type.question"],
        }, data);
    };

    utils.question_dict = function (uris) {
        var out = {};
        uris.forEach(function (u) {
            out[u] = this.question(u);
        }.bind(this));
        return out;
    };

    /** Configure a simple tutorial/lecture, ready for questions */
    utils.defaultLecture = function (quiz, settings) {
        return insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial', [
            {
                "answerQueue": [],
                "questions": [
                    {"uri": "ut:question0", "chosen": 20, "correct": 100},
                    {"uri": "ut:question1", "chosen": 40, "correct": 100},
                    {"uri": "ut:question2", "chosen": 40, "correct": 100},
                ],
                "settings": settings || { "hist_sel": '0' },
                "uri": "ut:lecture0",
                "material_uri": "ut:lecture0:all-questions",
            },
        ], utils.utQuestions).then(function () {
            return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});
        });
    };

    return utils;
}

function syncMockSubscriptions(quiz, default_settings) {
    var p = quiz.syncSubscriptions({ syncForce: true, lectureAdd: "x", lectureDel: "y" }, function () {
        return null;
    });

    return quiz.ajaxApi.waitForQueue(["POST /api/subscriptions/add?path=x 0"]).then(function () {
        quiz.ajaxApi.setResponse("POST /api/subscriptions/add?path=x", 0, {});

        return quiz.ajaxApi.waitForQueue(["POST /api/subscriptions/remove?path=y 1"]);
    }).then(function () {
        quiz.ajaxApi.setResponse("POST /api/subscriptions/remove?path=y", 1, {});

        return quiz.ajaxApi.waitForQueue(["POST /api/subscriptions/list 2"]);
    }).then(function () {
        quiz.ajaxApi.setResponse("POST /api/subscriptions/list", 2, { children: [
            { "path": "t0", title: "UT Tutorial 0", children: [
                { "path": "t0.l0", "title": "UT Lecture 0", children: [
                    { "path": "t0.l0.s0", "title": "UT Lecture 0 Stage 0", href: "/api/stage?path=t0.l0.s0" },
                ] },
            ] },
        ]});

        return quiz.ajaxApi.waitForQueue(["POST /api/stage?path=t0.l0.s0 3"]);
    }).then(function () {
        quiz.ajaxApi.setResponse("POST /api/stage?path=t0.l0.s0", 3, {
            "answerQueue": [],
            "material_tags": ["path.t0.l0.s0"],
            "questions": [
                {"uri": "ut:question0", "chosen": 20, "correct": 100},
                {"uri": "ut:question1", "chosen": 40, "correct": 100},
                {"uri": "ut:question2", "chosen": 40, "correct": 100},
            ],
            "settings": default_settings || {},
            "uri": "/api/stage?path=t0.l0.s0",
            // NB: Made up so we test overriding material_uri
            "material_uri": "material_uri_override?path=t0.l0.s0",
            "path": "t0.l0.s0",
        });

        return quiz.ajaxApi.waitForQueue(["GET material_uri_override?path=t0.l0.s0 4"]);
    }).then(function () {
        quiz.ajaxApi.setResponse("GET material_uri_override?path=t0.l0.s0", 4, {
            data: test_utils().utQuestions,
            stats: [
                { initial_answered: 0, initial_correct: 0, chosen: 0, correct: 0, uri: "ut:question0" },
                { initial_answered: 0, initial_correct: 0, chosen: 0, correct: 0, uri: "ut:question1" },
                { initial_answered: 0, initial_correct: 0, chosen: 0, correct: 0, uri: "ut:question2" },
            ],
        });

        return quiz.ajaxApi.waitForQueue([]);
    }).then(function () {
        return p;
    });
}


test('_getAvailableLectures', function (t) {
    var ls = new MockLocalStorage(),
        quiz = new Quiz(ls, new MockAjaxApi());

    return syncMockSubscriptions(quiz).then(function (args) {
        // At the start, everything should be synced
        return quiz.getAvailableLectures();
    }).then(function (subs) {
        t.deepEqual(subs.subscriptions, { children: [
            { "path": "t0", title: "UT Tutorial 0", children: [
                { "path": "t0.l0", "title": "UT Lecture 0", children: [
                    { "path": "t0.l0.s0", "title": "UT Lecture 0 Stage 0", href: "/api/stage?path=t0.l0.s0" },
                ] },
            ] },
        ]});
        t.deepEqual(subs.lectures, {
            '/api/stage?path=t0.l0.s0': { title: undefined, grade: 0, stats: undefined, synced: true, offline: true },
        });
        return quiz.setCurrentLecture({ lecUri: '/api/stage?path=t0.l0.s0' });
    }).then(function (args) {
        // Answer a question
        return (getQn(quiz, false));
    }).then(function (args) {
        return (setAns(quiz, 0));
    }).then(function (args) {
        // Now one is unsynced
        return quiz.getAvailableLectures();
    }).then(function (subs) {
        t.deepEqual(subs.lectures['/api/stage?path=t0.l0.s0'].synced, false);

    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

/** Should only remove genuinely unused objects */
broken_test('_removeUnusedObjects', function (t) {
    var ls = new MockLocalStorage(),
        aa = new MockAjaxApi(),
        quiz = new Quiz(ls, aa),
        ajaxPromise,
        utils = test_utils();

    // Load associated questions and a random extra
    ls.setItem('camel', 'yes');

    return insertTutorial(quiz,
        'ut:tutorial0',
        utils.utTutorial.title,
        utils.utTutorial.lectures,
        utils.utQuestions
        ).then(function () {

        t.deepEqual(Object.keys(ls.obj).sort(), [
            '_subscriptions',
            'camel',
            'ut:lecture0',
            'ut:question0',
            'ut:question1',
            'ut:question2',
        ]);

        ajaxPromise = quiz.syncLecture('ut:lecture0', true);
        return aa.waitForQueue(["POST ut:lecture0 0"]);

    }).then(function () {
        // Update lecture with new list of questions
        utils.utTutorial.lectures[0].questions = [
            {"uri": "ut:question0", "chosen": 20, "correct": 100},
            {"uri": "ut:question3", "chosen": 20, "correct": 100},
        ];
        aa.setResponse('POST ut:lecture0', 0, utils.utTutorial.lectures[0]);
        return aa.waitForQueue(["GET ut:question3 1"]);

    }).then(function () {
        // Give it the question too, wait for finish.
        aa.setResponse('GET ut:question3', 1, utils.utQuestions['ut:question1']);
        return ajaxPromise;
    }).then(function () {
        // syncLecture tidies up the questions
        t.deepEqual(Object.keys(ls.obj).sort(), [
            '_subscriptions',
            'ut:lecture0',
            'ut:question0',
            'ut:question3',
        ]);

        // RemoveUnused does too
        ls.setItem('orange', 'yes');
        return quiz.removeUnusedObjects();
    }).then(function () {
        t.deepEqual(Object.keys(ls.obj).sort(), [
            '_subscriptions',
            'ut:lecture0',
            'ut:question0',
            'ut:question3',
        ]);
    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

/** syncLecture should maintain any unsynced answerQueue entries */
broken_test('_syncLecture', function (t) {
    var ls = new MockLocalStorage(),
        aa = new MockAjaxApi(),
        quiz = new Quiz(ls, aa),
        assignedQns = [],
        ajaxPromise = null,
        opStatus = {},
        utils = test_utils();

    function logProgress(s, t, msg) {
        opStatus = { succeeded: s, total: t, message: msg };
    }

    return insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial', [
        {
            "answerQueue": [],
            "questions": [
                {"uri": "ut:question0", "chosen": 20, "correct": 100},
                {"uri": "ut:question1", "chosen": 40, "correct": 100},
                {"uri": "ut:question2", "chosen": 40, "correct": 100},
            ],
            "settings": { "hist_sel": 0 },
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
        },
    // No answers yet.
    ], utils.utQuestions).then(function () {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});

    // Should be nothing to do at start
    }).then(function (args) {
        ajaxPromise = quiz.syncLecture(null, false);
        return ajaxPromise;

    }).then(function (args) {
        t.deepEqual(aa.getQueue(), []);
        t.deepEqual(args, undefined);

    // Can force something to happen though
    }).then(function (args) {
        ajaxPromise = quiz.syncLecture(null, true, logProgress);
        return aa.waitForQueue(["POST ut:lecture0 0"]);

    }).then(function () {
        t.deepEqual(opStatus, { succeeded: 0, total: 3, message: 'Fetching lecture...' });
        t.deepEqual(aa.data['POST ut:lecture0 0'].answerQueue, []);
        aa.setResponse('POST ut:lecture0', 0, aa.data['POST ut:lecture0 0']);
        return ajaxPromise;

    // Answer some questions
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        t.ok(args.answerData.explanation.indexOf('The symbol for the set') !== -1); // Make sure answerData gets through
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return args;

    // Now should want to sync
    }).then(function (args) {
        ajaxPromise = quiz.syncLecture(null, false, logProgress);
        return aa.waitForQueue(["POST ut:lecture0 1"]);

    }).then(function () {
        t.deepEqual(aa.data['POST ut:lecture0 1'].answerQueue.map(function (a) { return a.synced; }), [
            false, false, false
        ]);
        t.deepEqual(opStatus, { succeeded: 0, total: 3, message: 'Fetching lecture...' });
        return null; //NB: Leave it waiting

    // Answer another question before we do.
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));

    // Finish the AJAX call
    }).then(function (args) {
        aa.setResponse('POST ut:lecture0', 1, {
            "answerQueue": [ {"camel" : 3, "time_end": 5, "lec_answered": 8, "lec_correct": 3, "synced" : true} ],
            "questions": [
                {"uri": "ut:question0", "chosen": 20, "correct": 100},
                {"uri": "ut:question2", "chosen": 40, "correct": 100},
                {"uri": "ut:question8", "chosen": 40, "correct": 100},
            ],
            "removed_questions": ['ut:question1'],
            "settings": { "any_setting": 0.5 },
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
        });
        return aa.waitForQueue(["GET ut:question8 2"]);

    // The missing question was fetched
    }).then(function () {
        t.deepEqual(opStatus, { succeeded: 1, total: 4, message: 'Fetching questions...' });
        aa.setResponse('GET ut:question8', 2, {
            "text": '<div>The symbol for the set of all irrational numbers is... (a)</div>',
            "choices": [
                '<div>$\\mathbb{R} \\backslash \\mathbb{Q}$ (me)</div>',
                '<div>$\\mathbb{Q} \\backslash \\mathbb{R}$</div>',
                '<div>$\\mathbb{N} \\cap \\mathbb{Q}$</div>'
            ],
            "shuffle": [0, 1, 2],
            "correct": { answer: [0] },
            "answer": {
                "explanation": "<div>\nThe symbol for the set of all irrational numbers (a)\n</div>",
            },
        });
        return ajaxPromise;
    }).then(function (args) {
        t.equal(
            ls.getParsedItem('ut:question8').text,
            '<div>The symbol for the set of all irrational numbers is... (a)</div>'
        );

    // Lecture should have been updated, with additional question kept
    }).then(function (args) {
        var lec = ls.getParsedItem('ut:lecture0');
        t.equal(lec.answerQueue.length, 2);
        t.deepEqual(lec.answerQueue[0], {
            "time_end": 5,
            "camel" : 3,
            "lec_answered": 8,
            "lec_correct": 3,
            "practice_answered": 0,
            "synced" : true,
        });
        t.equal(lec.answerQueue[1].uri, assignedQns[3].uri);
        // Counts have been bumped up accordingly
        t.equal(lec.answerQueue[1].lec_answered, 9);
        t.equal(lec.answerQueue[1].lec_correct, lec.answerQueue[1].correct ? 4 : 3);
        // Practice counts initialised
        t.equal(lec.answerQueue[1].practice_answered, 0);
        t.deepEqual(lec.answerQueue[1].synced, false);
        t.deepEqual(lec.settings, { "any_setting": 0.5 });

    // Take some questions, leave one unaswered, sync
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);

        ajaxPromise = quiz.syncLecture(null, false);
        return aa.waitForQueue(["POST ut:lecture0 3"]);

    }).then(function () {
        aa.setResponse('POST ut:lecture0', 3, {
            "answerQueue": [ {"camel" : 3, "synced" : true} ],
            "questions": [
                {"uri": "ut:question0", "chosen": 20, "correct": 100},
                {"uri": "ut:question2", "chosen": 40, "correct": 100},
                {"uri": "ut:question8", "chosen": 40, "correct": 100},
            ],
            "removed_questions": ['ut:question1'],
            "settings": { "hist_sel": 0 },
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
        });
        return ajaxPromise;

    // Unanswered question still on end
    }).then(function (args) {
        var lec = ls.getParsedItem('ut:lecture0');
        t.equal(lec.answerQueue.length, 2);
        t.deepEqual(lec.answerQueue[0], {"camel" : 3, "synced" : true, lec_answered: 0, lec_correct: 0, practice_answered: 0});
        t.equal(assignedQns.length, 6);
        t.equal(lec.answerQueue[1].uri, assignedQns[assignedQns.length - 1].uri);

    // Answer question, ask a practice question. Answer practice question mid-sync
    }).then(function (args) {
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, true));
    }).then(function (args) {
        assignedQns.push(args.a);
        ajaxPromise = quiz.syncLecture(null, false);
        return aa.waitForQueue(['POST ut:lecture0 4']);

    }).then(function () {
        return setAns(quiz, 0);
    }).then(function (args) {
        aa.setResponse('POST ut:lecture0', 4, {
            "answerQueue": [ {"camel" : 3, "lec_answered": 8, "lec_correct": 3, "synced" : true} ],
            "questions": [
                {"uri": "ut:question0", "chosen": 20, "correct": 100},
                {"uri": "ut:question2", "chosen": 40, "correct": 100},
                {"uri": "ut:question8", "chosen": 40, "correct": 100},
            ],
            "removed_questions": ['ut:question1'],
            "settings": { "hist_sel": 0 },
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
        });
        return ajaxPromise;
    }).then(function (args) {
        var lec = ls.getParsedItem('ut:lecture0');
        t.equal(lec.answerQueue.length, 2);
        t.equal(assignedQns.length, 7);
        t.equal(lec.answerQueue[1].lec_answered, 9);
        t.equal(lec.answerQueue[1].lec_correct, assignedQns[6].correct ? 4 : 3);
        t.equal(lec.answerQueue[1].practice_answered, 1);

    // Counts start from zero if server doesn't tell us otherwise
    }).then(function (args) {
        var syncPromise = quiz.syncLecture(null, false);

        return aa.waitForQueue(['POST ut:lecture0 5']).then(function (args) {
            aa.setResponse('POST ut:lecture0', 5, {
                "answerQueue": [
                    {"correct": true,  "student_answer": { "practice": false }, "synced" : true, "time_end": 1 },
                    {"correct": true,  "student_answer": { "practice": false }, "synced" : true, "time_end": 2 },
                    {"correct": false, "student_answer": { "practice": true },  "synced" : true, "time_end": 3 },
                    {"correct": true,  "student_answer": { "practice": true },  "synced" : true, "time_end": 4 },
                    {"correct": true,  "student_answer": { "practice": false }, "synced" : true, "time_end": 5 },
                ],
                "questions": [
                    {"uri": "ut:question0", "chosen": 20, "correct": 100},
                    {"uri": "ut:question2", "chosen": 40, "correct": 100},
                    {"uri": "ut:question8", "chosen": 40, "correct": 100},
                ],
                "settings": { "hist_sel": 0 },
                "uri": "ut:lecture0",
                "material_uri": "ut:lecture0:all-questions",
            });
            return syncPromise;
        });
    }).then(function (args) {
        var lec = ls.getParsedItem('ut:lecture0');
        function aqProperty(k) {
            return lec.answerQueue.map(function (a) { return a[k]; });
        }

        t.deepEqual(aqProperty('lec_answered'), [1, 2, 3, 4, 5]);
        t.deepEqual(aqProperty('lec_correct'),  [1, 2, 2, 3, 4]);
        t.deepEqual(aqProperty('practice_answered'), [0, 0, 1, 2, 2]);

    // Do a sync with the wrong user, we complain.
    }).then(function (args) {
        var lec = ls.getParsedItem('ut:lecture0');

        lec.user = 'ut_student';
        ls.setItem('ut:lecture0', JSON.stringify(lec));
        ajaxPromise = quiz.syncLecture(null, true);
        return aa.waitForQueue(['POST ut:lecture0 6']);

    }).then(function (args) {
        aa.setResponse('POST ut:lecture0', 6, {
            "answerQueue": [],
            "user": "not_the_user_you_are_looking_for",
            "questions": [],
            "settings": { "hist_sel": 0 },
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
        });
        return ajaxPromise.then(function () { t.fail(); }).catch(function (err) {
            var lec = ls.getParsedItem('ut:lecture0');

            t.ok(err.message.indexOf("not_the_user_you_are_looking_for") > -1);
            t.equal(lec.answerQueue.length, 5);
            t.equal(lec.questions.length, 3);
            t.ok(lec.user !== "not_the_user_you_are_looking_for");
        });

    // If lots of questions are added, just fetch the whole lot
    }).then(function (args) {
        ajaxPromise = quiz.syncLecture(null, true);
        return aa.waitForQueue(['POST ut:lecture0 7']);
    }).then(function (args) {
        aa.setResponse('POST ut:lecture0', 7, {
            "answerQueue": [],
            "user": 'ut_student',
            "questions": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(function (i) {
                return {"uri": "ut:question" + i, "chosen": 20, "correct": 100};
            }),
            "settings": { "hist_sel": 0 },
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
        });
        return aa.waitForQueue(['GET ut:lecture0:all-questions 8']);
    }).then(function (args) {
        var newQuestions = {};

        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(function (i) {
            newQuestions['ut:question' + i] = {
                text: "This is Question " + i,
            };
        });
        aa.setResponse('GET ut:lecture0:all-questions', 8, newQuestions);
        return ajaxPromise.then(function () {
            // All new questions updated
            Object.keys(newQuestions).map(function (k) {
                t.deepEqual(ls.getParsedItem(k), newQuestions[k]);
            });
        });

    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});
//TODO: Test that Other parameters can be modified, e.g. title.

broken_test('_setQuestionAnswer', function (t) {
    var ls = new MockLocalStorage(),
        quiz = new Quiz(ls),
        assignedQns = [],
        startTime = Math.round((new Date()).getTime() / 1000) - 1,
        utils = test_utils();

    return utils.defaultLecture(quiz).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, {}));

    // Fail to answer question, should get a null for the student answer
    }).then(function (args) {
        var lec = ls.getParsedItem('ut:lecture0');
        t.equal(lec.answerQueue.length, 1);
        t.ok(lec.answerQueue[0].time_end > startTime);
        t.equal(typeof lec.answerQueue[0].student_answer, "object");
        t.equal(lec.answerQueue[0].student_answer, null);
        t.equal(typeof lec.answerQueue[0].selected_answer, "object");
        t.equal(lec.answerQueue[0].selected_answer, null);

    // Add a tutorial with a template question
    }).then(function (args) {
        return insertTutorial(quiz, 'ut:tmpltutorial', 'UT template qn tutorial', [
            {
                "answerQueue": [],
                "questions": [
                    {"uri": "ut:tmplqn0"},
                ],
                "settings": { "hist_sel": 0 },
                "uri": "ut:lecture0",
                "material_uri": "ut:lecture0:all-questions",
            },
        ], {
            "ut:tmplqn0": {
                "_type": "template",
                "title": "Write a question about fish",
                "hints": "<div class=\"ttm-output\">You could ask something about their external appearance</div>",
                "example_text": "How many toes?",
                "example_explanation": "why would they have toes?'",
                "example_choices": ["4", "5"],
                "student_answer": {},
            },
        });
    }).then(function (args) {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});

    // Add a tutorial with a usergenerated question
    }).then(function (args) {
        return insertTutorial(quiz, 'ut:ugtutorial', 'UT template qn tutorial', [
            {
                "answerQueue": [],
                "questions": [
                    {"uri": "ut:ugqn0"},
                ],
                "settings": { "hist_sel": 0 },
                "uri": "ut:lecture0",
                "material_uri": "ut:lecture0:all-questions",
            },
        ], {
            "ut:ugqn0": {
                "_type": "usergenerated",
                "question_id": 999,
                "text": "Riddle me this.",
                "choices": ["Yes", "No"],
                "shuffle": [0, 1],
                "answer": {
                    "correct": [0],
                    "explanation": "It'd be boring otherwise"
                }
            },
        });
    }).then(function (args) {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'}, function () { return null; });

    // Fetch a usergenerated question and answer it, should be marked but not "answered"
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        return setAns(quiz, args.a.ordering.indexOf(0).toString());
    }).then(function (args) {
        t.equal(args.answerData.explanation, "It'd be boring otherwise");
        t.ok(!args.a.hasOwnProperty("correct"));
        t.ok(!args.a.hasOwnProperty("time_end"));
        t.deepEqual(args.a.student_answer, { choice: 0 });

        // Could have only ordered the questions 2 ways
        if (args.a.ordering[0] === 0) {
            t.deepEqual(args.a.ordering, [0, 1]);
            t.deepEqual(args.a.ordering_correct, [true, false]);
        } else {
            t.deepEqual(args.a.ordering, [1, 0]);
            t.deepEqual(args.a.ordering_correct, [false, true]);
        }
        return args;

    // Try again with a comment, even empty should be properly answered
    }).then(function (args) {
        return (setAns(quiz, {
            "answer": args.a.ordering.indexOf(0).toString(),
            "comments": "",
        }));
    }).then(function (args) {
        t.ok(!args.a.hasOwnProperty("correct")); // NB: Never have correct
        t.ok(args.a.hasOwnProperty("time_end"));
        t.deepEqual(args.a.student_answer, { choice: 0, comments: "" });

    // Start again, fill in everything
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        return (setAns(quiz, {
            "answer": args.a.ordering.indexOf(1).toString(),
            "comments": "Boo!",
            "rating": "50",
        }));
    }).then(function (args) {
        t.ok(!args.a.hasOwnProperty("correct")); // NB: Never have correct
        t.ok(args.a.hasOwnProperty("time_end"));
        t.deepEqual(args.a.student_answer, { choice: 1, comments: "Boo!", rating: 50 });

    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

test('_setQuestionAnswer_exam', function (t) {
    var ls = new MockLocalStorage(),
        quiz = new Quiz(ls, new MockAjaxApi());

    newTutorial(quiz, "ut:tut0", { grade_algorithm: "ratiocorrect" }, [5, 10]).then(function () {
        return setCurLec(quiz, "ut:tut0", "ut:tut0:lec0");

    // Get a question and answer it incorrectly, score is 0 / 5 * 10
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        return (setAns(quiz, chooseAnswer(args, false)));
    }).then(function (args) {
        t.deepEqual(args.a.grade_after, 0);

    // Get a question and answer it correctly, score is 1 / 5 * 10
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        return (setAns(quiz, chooseAnswer(args, true)));
    }).then(function (args) {
        t.deepEqual(args.a.grade_after, 2);

    // Get a question and answer it correctly, score is 2 / 5 * 10
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        return (setAns(quiz, chooseAnswer(args, true)));
    }).then(function (args) {
        t.deepEqual(args.a.grade_after, 4);

    // Get a question and answer it incorrectly, score is 2 / 5 * 10
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        return (setAns(quiz, chooseAnswer(args, false)));
    }).then(function (args) {
        t.deepEqual(args.a.grade_after, 4);

    // Switch lectures to one with 10 questions
    }).then(function (args) {
        return (setCurLec(quiz, "ut:tut0", "ut:tut0:lec1"));

    // Get a question and answer it correctly, score is 1 / 10 * 10
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        return (setAns(quiz, chooseAnswer(args, true)));
    }).then(function (args) {
        t.deepEqual(args.a.grade_after, 1);

    // Get a question and answer it correctly, score is 2 / 10 * 10
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        return (setAns(quiz, chooseAnswer(args, true)));
    }).then(function (args) {
        t.deepEqual(args.a.grade_after, 2);

    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

/** Explanation delay should increase with incorrect questions */
test('_explanationDelay', function (t) {
    var ls = new MockLocalStorage(),
        quiz = new Quiz(ls, new MockAjaxApi()),
        utils = test_utils();

    utils.defaultLecture(quiz, {
        studytime_answeredfactor: '10',
        studytime_factor: '2',
        studytime_max: '1000',
    }).then(function (args) {
        return (getQn(quiz, false));

    // Get question wrong, already have a delay set
    }).then(function (args) {
        return (setAns(quiz, chooseAnswer(args, false)));
    }).then(function (args) {
        t.deepEqual(args.a.correct, false);
        t.deepEqual(args.a.explanation_delay, 2);
        return (getQn(quiz, false));

    // This increases with next question
    }).then(function (args) {
        return (setAns(quiz, chooseAnswer(args, false)));
    }).then(function (args) {
        t.deepEqual(args.a.correct, false);
        t.deepEqual(args.a.explanation_delay, 2 * 2 + 10);
        return (getQn(quiz, false));

    // Correct answer resets
    }).then(function (args) {
        return (setAns(quiz, chooseAnswer(args, true)));
    }).then(function (args) {
        t.deepEqual(args.a.correct, true);
        t.deepEqual(args.a.explanation_delay, 2 * 10);
        return (getQn(quiz, false));

    // Get it wrong, but took some time, delay isn't noticable
    }).then(function (args) {
        tk.travel(new Date((new Date()).getTime() + 50000));
        return (setAns(quiz, chooseAnswer(args, false)));
    }).then(function (args) {
        t.deepEqual(args.a.correct, false);
        t.deepEqual(args.a.explanation_delay, 0); // NB: Would be 1 * 2 + 3 * 10 - 50
        tk.reset();
        return (getQn(quiz, false));

    // Next time it is
    }).then(function (args) {
        tk.travel(new Date((new Date()).getTime() + 30000));
        return (setAns(quiz, chooseAnswer(args, false)));
    }).then(function (args) {
        t.deepEqual(args.a.correct, false);
        t.deepEqual(args.a.explanation_delay, 14); // NB: Would be 2 * 2 + 4 * 10 - 30
        tk.reset();
        return (getQn(quiz, false));

    }).then(function (args) {
        tk.reset();
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        tk.reset();
        t.end();
    });
});

/** We should get various strings encouraging users */
test('_gradeSummaryStrings', function (t) {
    var ls = new MockLocalStorage(),
        quiz = new Quiz(ls, new MockAjaxApi()),
        assignedQns = [],
        utils = test_utils();

    // Insert tutorial, no answers yet.
    return insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial', [
        {
            "answerQueue": [],
            "questions": [
                {"uri": "ut:question0", "chosen": 20, "correct": 100},
                {"uri": "ut:question1", "chosen": 40, "correct": 100},
                {"uri": "ut:question2", "chosen": 40, "correct": 100},
            ],
            "settings": {
                "hist_sel": 0,
                "award_stage_aced":  1024,
                "award_tutorial_aced": 10960, // NB: these values are mSMLY, need rounding
            },
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
        },
    ], utils.utQuestions).then(function (args) {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});

    // At start, we have no grade, but know how many SMLY we get,
    }).then(function (args) {
        return quiz.lectureGradeSummary();
    }).then(function (grade_summary) {
        t.equal(grade_summary.practice, undefined);
        t.equal(grade_summary.practiceStats, undefined);
        t.equal(grade_summary.stats, undefined);
        t.equal(grade_summary.grade, undefined);
        t.equal(grade_summary.encouragement, 'Win 1 SMLY if you ace this stage, bonus 11 SMLY for acing whole tutorial');
        return (getQn(quiz, false));

    // Answer some questions, don't see our grade yet
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return quiz.lectureGradeSummary().then(function (grade_summary) {
            t.equal(grade_summary.practice, undefined);
            t.equal(grade_summary.practiceStats, undefined);
            t.equal(grade_summary.stats, 'Answered 0 questions, 0 correctly.');
            t.equal(grade_summary.grade, 'Answer 7 more questions to see your grade');
            t.equal(grade_summary.encouragement, 'Win 1 SMLY if you ace this stage, bonus 11 SMLY for acing whole tutorial');
            return (setAns(quiz, chooseAnswer(args, true)));
        });
    }).then(function (args) {
        return quiz.lectureGradeSummary();
    }).then(function (grade_summary) {
        t.equal(grade_summary.practice, undefined);
        t.equal(grade_summary.practiceStats, undefined);
        t.equal(grade_summary.stats, 'Answered 1 questions, 1 correctly.');
        t.equal(grade_summary.grade, 'Answer 7 more questions to see your grade');
        t.equal(grade_summary.encouragement, 'Win 1 SMLY if you ace this stage, bonus 11 SMLY for acing whole tutorial');

    }).then(function (args) {
        return (getQn(quiz, true));
    }).then(function (args) {
        return quiz.lectureGradeSummary().then(function (grade_summary) {
            t.equal(grade_summary.practice, "Practice mode");
            t.equal(grade_summary.practiceStats, "Answered 0 practice questions.");
            t.equal(grade_summary.stats, 'Answered 1 questions, 1 correctly.');
            t.equal(grade_summary.grade, 'Answer 6 more questions to see your grade');
            t.equal(grade_summary.encouragement, 'Win 1 SMLY if you ace this stage, bonus 11 SMLY for acing whole tutorial');
            return (setAns(quiz, chooseAnswer(args, false)));
        });
    }).then(function (args) {
        return (getQn(quiz, false)).then(function (args) {
            return quiz.lectureGradeSummary().then(function (grade_summary) {
                t.equal(grade_summary.grade, 'Answer 5 more questions to see your grade');
                return setAns(quiz, chooseAnswer(args, false));
            });
        });
    }).then(function (args) {
        return (getQn(quiz, false)).then(function (args) {
            return quiz.lectureGradeSummary().then(function (grade_summary) {
                t.equal(grade_summary.grade, 'Answer 4 more questions to see your grade');
                return setAns(quiz, chooseAnswer(args, false));
            });
        });
    }).then(function (args) {
        return (getQn(quiz, false)).then(function (args) {
            return quiz.lectureGradeSummary().then(function (grade_summary) {
                t.equal(grade_summary.grade, 'Answer 3 more questions to see your grade');
                return setAns(quiz, chooseAnswer(args, false));
            });
        });
    }).then(function (args) {
        return (getQn(quiz, false)).then(function (args) {
            return quiz.lectureGradeSummary().then(function (grade_summary) {
                t.equal(grade_summary.grade, 'Answer 2 more questions to see your grade');
                return setAns(quiz, chooseAnswer(args, false));
            });
        });
    }).then(function (args) {
        return (getQn(quiz, false)).then(function (args) {
            return quiz.lectureGradeSummary().then(function (grade_summary) {
                t.equal(grade_summary.grade, 'Answer 1 more questions to see your grade');
                return setAns(quiz, chooseAnswer(args, false));
            });
        });
    }).then(function (args) {
        return (getQn(quiz, false)).then(function (args) {
            return quiz.lectureGradeSummary().then(function (grade_summary) {
                t.equal(grade_summary.grade, 'Your grade: 0');
                return setAns(quiz, chooseAnswer(args, false));
            });
        });
    }).then(function (args) {
        return (getQn(quiz, false)).then(function (args) {
            return setAns(quiz, chooseAnswer(args, true)).then(function (args) {
                return quiz.lectureGradeSummary().then(function (grade_summary) {
                    t.equal(grade_summary.grade, 'Your grade: 0.25');
                    t.equal(grade_summary.encouragement, 'If you get the next question right: 3.25');
                });
            });
        });

    }).then(function (args) {
        return (getQn(quiz, true));
    }).then(function (args) {
        return quiz.lectureGradeSummary();
    }).then(function (grade_summary) {
        t.equal(grade_summary.practice, "Practice mode");
        t.equal(grade_summary.practiceStats, "Answered 1 practice questions.");

    // Stop it and tidy up
    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

/** lastEight should return last relevant questions */
test('_gradeSummarylastEight', function (t) {
    var ls = new MockLocalStorage(),
        quiz = new Quiz(ls, new MockAjaxApi()),
        assignedQns = [],
        utils = test_utils();

    // Insert tutorial, no answers yet.
    return insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial', [
        {
            "answerQueue": [],
            "questions": [
                {"uri": "ut:question0", "chosen": 20, "correct": 100},
                {"uri": "ut:question1", "chosen": 40, "correct": 100},
                {"uri": "ut:question2", "chosen": 40, "correct": 100},
            ],
            "settings": { "hist_sel": 0 },
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
        },
    ], utils.utQuestions).then(function (args) {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});

    // lastEight returns nothing
    }).then(function (args) {
        return quiz.lectureGradeSummary();
    }).then(function (grade_summary) {
        t.deepEqual(grade_summary.lastEight, []);

    // Answer some questions
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return quiz.lectureGradeSummary();
    }).then(function (grade_summary) {
        t.equal(grade_summary.lastEight.length, 3);
        t.equal(grade_summary.lastEight[0].uri, assignedQns[2].uri);
        t.equal(grade_summary.lastEight[1].uri, assignedQns[1].uri);
        t.equal(grade_summary.lastEight[2].uri, assignedQns[0].uri);

    // Unanswered questions don't count
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return quiz.lectureGradeSummary();
    }).then(function (grade_summary) {
        t.equal(grade_summary.lastEight.length, 3);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return quiz.lectureGradeSummary();
    }).then(function (grade_summary) {
        t.equal(grade_summary.lastEight.length, 4);
        t.equal(grade_summary.lastEight[3].uri, assignedQns[0].uri);

    // Practice questions don't count
    }).then(function (args) {
        return (getQn(quiz, true));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, true));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return quiz.lectureGradeSummary();
    }).then(function (grade_summary) {
        t.equal(grade_summary.lastEight.length, 5);
        t.equal(grade_summary.lastEight[0].uri, assignedQns[6].uri);
        t.equal(grade_summary.lastEight[1].uri, assignedQns[3].uri);
        t.equal(grade_summary.lastEight[2].uri, assignedQns[2].uri);
        t.equal(grade_summary.lastEight[3].uri, assignedQns[1].uri);
        t.equal(grade_summary.lastEight[4].uri, assignedQns[0].uri);

    // Old questions don't count
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return (getQn(quiz, false));
    }).then(function (args) {
        assignedQns.push(args.a);
        return (setAns(quiz, 0));
    }).then(function (args) {
        return quiz.lectureGradeSummary();
    }).then(function (grade_summary) {
        t.equal(grade_summary.lastEight.length, 8);
        t.equal(grade_summary.lastEight[0].uri, assignedQns[11].uri);
        t.equal(grade_summary.lastEight[1].uri, assignedQns[10].uri);
        t.equal(grade_summary.lastEight[2].uri, assignedQns[9].uri);
        t.equal(grade_summary.lastEight[3].uri, assignedQns[8].uri);
        t.equal(grade_summary.lastEight[4].uri, assignedQns[7].uri);
        t.equal(grade_summary.lastEight[5].uri, assignedQns[6].uri);
        t.equal(grade_summary.lastEight[6].uri, assignedQns[3].uri);
        t.equal(grade_summary.lastEight[7].uri, assignedQns[2].uri);
    }).then(function (args) {
        t.end();
    });
});

/** Should update question count upon answering questions */
test('_questionUpdate ', function (t) {
    var ls = new MockLocalStorage(),
        quiz = new Quiz(ls, new MockAjaxApi()),
        assignedQns = [],
        qnBefore,
        utils = test_utils();

    // Emulate old onSuccess interface
    function gnq(opts, onSuccess) {
        return quiz.getNewQuestion(opts).then(function (args) {
            return onSuccess(args.qn, args.a);
        });
    }
    function sqa(opts, onSuccess) {
        return quiz.setQuestionAnswer(opts).then(function (args) {
            return onSuccess(args.a, args.answerData);
        });
    }

    // Turn questions into a hash for easy finding
    function qnHash() {
        var out = {};
        ls.getParsedItem('ut:lecture0').questions.map(function (qn) {
            out[qn.uri] = {"chosen": qn.chosen, "correct": qn.correct};
        });
        return out;
    }

    // Insert tutorial, no answers yet.
    return insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial', [
        {
            "answerQueue": [],
            "questions": [
                {"uri": "ut:question0", "chosen": 20, "correct": 100},
                {"uri": "ut:question1", "chosen": 40, "correct": 100},
                {"uri": "ut:question2", "chosen": 40, "correct": 100},
            ],
            "settings": { "hist_sel": 0 },
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
        },
    ], utils.utQuestions).then(function (args) {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});
    }).then(function (args) {
        qnBefore = qnHash();

        // Assign a question, should see jump in counts
        return gnq({practice: true}, function (qn, a) {
            assignedQns.push(a);
            return sqa([{name: "answer", value: 0}], function () {
                t.equal(
                    qnBefore[assignedQns[0].uri].chosen + 1,
                    qnHash()[assignedQns[0].uri].chosen
                );
                t.ok(
                    (qnBefore[assignedQns[0].uri].correct === qnHash()[assignedQns[0].uri].correct) ||
                        (qnBefore[assignedQns[0].uri].correct + 1 === qnHash()[assignedQns[0].uri].correct)
                );
            });
        });

    }).then(function (args) {
        tk.reset();
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

test('getQuestionReviewForm', function (t) {
    var ls = new MockLocalStorage(),
        aa = new MockAjaxApi(),
        quiz = new Quiz(ls, aa),
        utils = test_utils();

    return insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial', [
        {
            "uri": "ut:lecture0",
            "answerQueue": [],
            "questions": [ {"uri": "ut:qn-custom-template", "chosen": 20, "correct": 100} ],
            "material_uri": "ut:lecture0:all-questions",
            "settings": { },
        },
        {
            "uri": "ut:lecture1",
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "material_uri": "ut:lecture1:all-questions",
            "settings": { },
        },
    ], Object.assign({}, utils.utQuestions, {
        "ut:qn-custom-template": {
            content: "<p>This is good stuff</p>",
            correct: [],
            review_questions: [
                {name: 'qn1', title: 'Question 1', values: [[0, 'Bad'], [-1, 'Even worse']]},
                {name: 'qn2', title: 'Question 2', values: [[0, 'Bad'], [-1, 'Even worse']]},
            ],
        }
    })).then(function () {

        // Lecture0 has a question with a custom template
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});
    }).then(function (args) {
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0)).then(quiz.getQuestionReviewForm.bind(quiz));
    }).then(function (form_desc) {
        // getQuestionReviewForm returns custom form
        t.deepEqual(form_desc.map(function (r) { return r.name; }), [
            'qn1',
            'qn2',
        ]);

        // Lecture1's question just uses the default
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture1'});
    }).then(function (args) {
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0)).then(quiz.getQuestionReviewForm.bind(quiz));
    }).then(function (form_desc) {
        // getQuestionReviewForm returns custom form
        t.deepEqual(form_desc.map(function (r) { return r.name; }), [
            'content',
        ]);

    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

test('_setCurrentLecture_practiceAllowed', function (t) {
    var ls = new MockLocalStorage(),
        aa = new MockAjaxApi(),
        quiz = new Quiz(ls, aa),
        utils = test_utils();

    return insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial', [
        {
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            // Unlimited practicing
            "settings": { 'practice_after': 0, 'practice_batch': Infinity },
        }, {
            "uri": "ut:lecture1",
            "material_uri": "ut:lecture1:all-questions",
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            // Unlimited practicing, once we get to 10 questions
            "settings": { 'practice_after': 5, 'practice_batch': Infinity },
        }, {
            "uri": "ut:lecture2",
            "material_uri": "ut:lecture2:all-questions",
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            // 1 practice question per 2 real questions
            "settings": { 'practice_after': 2, 'practice_batch': 3 },
        },
    ], utils.utQuestions).then(function () {

        // Lecture0 always allows practice questions
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});
    }).then(function (args) {
        t.equal(args.practiceAllowed, Infinity);
    }).then(function (args) {
        // Answer a practice question
        return getQn(quiz, true).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        // setQuestionAnswer says infinity too
        t.equal(args.practiceAllowed, Infinity);

        // Lecture1 allows practice questions once we get to 5
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture1'});
    }).then(function (args) {
        t.equal(args.practiceAllowed, 0);
        // getQn refuses to get practice questions
        return getQn(quiz, true).then(function () { t.fail(); }).catch(function (err) {
            t.ok(err.message.indexOf("No practice questions left") > -1);
        });
    }).then(function (args) {
        // Still not allowed after 4 real questions
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        t.equal(args.practiceAllowed, 0);
    }).then(function (args) {
        // The fifth goes to infinity
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        t.equal(args.practiceAllowed, Infinity);
        // Doesn't change with practice
        return getQn(quiz, true).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        t.equal(args.practiceAllowed, Infinity);

        // Lecture2 allows practice questions once we get to 2
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture2'});
    }).then(function (args) {
        t.equal(args.practiceAllowed, 0);
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        t.equal(args.practiceAllowed, 0);
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        t.equal(args.practiceAllowed, 3);
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        t.equal(args.practiceAllowed, 3);
        return getQn(quiz, false).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        t.equal(args.practiceAllowed, 6);  // NB: We roll-over
        // Use them up with practice questions
        return getQn(quiz, true).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        t.equal(args.practiceAllowed, 5);
        return getQn(quiz, true).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        t.equal(args.practiceAllowed, 4);
        return getQn(quiz, true).then(setAns.bind(null, quiz, 0));
    }).then(function (args) {
        t.equal(args.practiceAllowed, 3);

    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

test('_getNewQuestion', function (t) {
    var ls = new MockLocalStorage(),
        aa = new MockAjaxApi(),
        promise,
        quiz = new Quiz(ls, aa),
        assignedQns = [],
        startTime = Math.round((new Date()).getTime() / 1000) - 2,
        utils = test_utils();

    return insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial', [
        {
            "answerQueue": [],
            "questions": [
                {"uri": "ut:question0", "chosen": 20, "correct": 100},
                {"uri": "ut:question1", "chosen": 40, "correct": 100},
                {"uri": "ut:question2", "chosen": 40, "correct": 100},
            ],
            "settings": { hist_sel: '0', timeout_std: "2", timeout_min: 3, timeout_max: 10, timeout_grade: 5 },
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
        },
        {
            "answerQueue": [],
            "questions": [
                {"uri": "ut:question-a", "chosen": 20, "correct": 100, "online-only": "true"},
            ],
            "settings": { hist_sel: '0', timeout_std: "2", timeout_min: 3, timeout_max: 10, timeout_grade: 5 },
            "uri": "ut:lecture-online",
            "material_uri": "ut:lecture0:all-questions",
        },
    ], utils.utQuestions).then(function () {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});
    }).then(function () {
        return quiz.getNewQuestion({practice: false});
    }).then(function (args) {
        var qn = args.qn, a = args.a;

        assignedQns.push(a);
        // Question data has been set up
        t.equal(a.synced, false);
        if (qn.shuffle.length < qn.choices.length) {
            // Not shuffling everything, so last item should always be last question.
            qn.shuffle[qn.shuffle.length - 1] = 2;
        }
        t.ok(a.time_start > startTime);
        t.equal(a.allotted_time, 582);
        t.equal(a.allotted_time, a.remaining_time);

        // Question data has URI inside
        t.equal(a.uri, qn.uri);

        // Counts have all started at 0
        t.equal(a.lec_answered, 0);
        t.equal(a.lec_correct, 0);
        t.equal(a.practice_answered, 0);
        t.equal(a.practice_answered, 0);

        // Pass some time, then request the same question again.
        tk.travel(new Date((new Date()).getTime() + 3000));
        t.notEqual(startTime, Math.round((new Date()).getTime() / 1000) - 1);
        t.equal(ls.getParsedItem('ut:lecture0').answerQueue.length, 1);

        return quiz.getNewQuestion({practice: false}).then(function (args) {
            var new_a = args.a;

            // No question answered, so just get the same one back.
            t.deepEqual(a.uri, new_a.uri);
            t.deepEqual(a.ordering, new_a.ordering);
            t.equal(ls.getParsedItem('ut:lecture0').answerQueue.length, 1);
            t.equal(a.allotted_time, new_a.remaining_time + 3); //3s have passed

            // Answer it, get new question
            return quiz.setQuestionAnswer([{name: "answer", value: 0}]);
        });

    }).then(function (args) {
        return quiz.getNewQuestion({practice: false});
    }).then(function (args) {
        var a = args.a;

        t.equal(ls.getParsedItem('ut:lecture0').answerQueue.length, 2);

        // Time has advanced
        t.equal(assignedQns[assignedQns.length - 1].time_start, a.time_start - 3);

        // Counts have gone up
        t.equal(a.lec_answered, 1);
        t.ok(a.lec_correct <= a.lec_answered);
        t.equal(a.practice_answered, 0);

        // Answer, get practice question
        return quiz.setQuestionAnswer([{name: "answer", value: 0}]);
    }).then(function (args) {
        return quiz.getNewQuestion({practice: true});
    }).then(function (args) {
        var a = args.a;

        t.equal(ls.getParsedItem('ut:lecture0').answerQueue.length, 3);

        // Counts have gone up (but for question we answered)
        t.equal(a.lec_answered, 2);
        t.ok(a.lec_correct <= a.lec_answered);
        t.equal(a.practice_answered, 0);

        // Answer it, practice counts go up
        return quiz.setQuestionAnswer([{name: "answer", value: 0}]);
    }).then(function (args) {
        var a = args.a;

        t.equal(a.lec_answered, 3);
        t.ok(a.lec_correct <= a.lec_answered);
        t.equal(a.practice_answered, 1);

    // Fetch an online question 
    }).then(function () {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture-online'});
    }).then(function () {
        promise = quiz.getNewQuestion({practice: false});
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 0"]);

    // Returning a fail should result in another attempt
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 0, new Error("Go away"));
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 1"]);

    // Return actual promise which should get us a question
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 1, {
            data: utils.question_dict(["ut:question-a"]),
            stats: { initial_answered: 0, initial_correct: 0, chosen: 0, correct: 0, uri: "ut:question-a" },
        });
        return promise;
    }).then(function (args) {
        t.equal(args.qn.content, '<div>\n<pre>ut:question-a</pre>\n</div>');
        // The question data is cached
        t.equal(quiz._lastFetched.material_data.content, '<div>\n<pre>ut:question-a</pre>\n</div>');
        quiz._lastFetched.material_data.content = '<div>cached-value</div>';
        // NB: setQuestionAnswer shoudn't generate another request
        return quiz.setQuestionAnswer([{name: "answer", value: 0}]);
    }).then(function (args) {
        // Got our modified cached-value from above
        t.equal(args.qn.content, '<div>cached-value</div>');

    // If we keep failing, eventually the error bubbles up.
    }).then(function () {
        promise = quiz.getNewQuestion({practice: false});
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 2"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 2, new Error("Go away"));
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 3"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 3, {data: {"ut:question-a": {
            error: "Erk",  // NB: An error causes a retry loop, just as missing questions do
            data: {"ut:question-a": utils.utQuestions["ut:question0"]}
        }}, stats: { initial_answered: 0, initial_correct: 0, chosen: 0, correct: 0, uri: "ut:question-a"} });
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 4"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 4, new Error("Go away"));
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 5"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 5, new Error("Go away"));
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 6"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 6, new Error("Go away"));
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 7"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 7, new Error("Go away"));
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 8"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 8, new Error("Go away"));
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 9"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 9, new Error("Go away"));
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 10"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 10, new Error("Go away"));
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 11"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 11, new Error("Go away"));
        return aa.waitForQueue(["GET ut:lecture0:all-questions&id=ut%3Aquestion-a 12"]);
    }).then(function (args) {
        aa.setResponse('GET ut:lecture0:all-questions&id=ut%3Aquestion-a', 12, new Error("Go away now!"));
        return promise.then(function () { t.fail(); }).catch(function (err) {
            t.equal(err.message, "Go away now!");
        }).then(function () {
            return aa.waitForQueue([]);
        });

    }).then(function (args) {
        tk.reset();
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

test('_setCurrentLecture', function (t) {
    var ls = new MockLocalStorage(),
        quiz = new Quiz(ls, new MockAjaxApi()),
        utils = test_utils();

    t.ok(!quiz.isLectureSelected());
    insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial 0', [
        {
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture0t0",
            "material_uri": "ut:lecture0t0:all-questions",
            "title": "UT Lecture 0 (no answers)",
        },
        {
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture1",
            "material_uri": "ut:lecture1:all-questions",
            "title": "UT Lecture 1 (no answers)",
        },
        {
            "answerQueue": [ { student_answer: {practice: true} } ],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture-currentpract",
            "material_uri": "ut:lecture-currentpract:all-questions",
            "title": "UT Lecture: Currently practicing",
        },
        {
            "answerQueue": [ { student_answer: {practice: false} } ],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture-currentreal",
            "material_uri": "ut:lecture-currentreal:all-questions",
            "title": "UT Lecture: Currently real",
        },
        {
            //NB: answerQueue created for us
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture0t1",
            "material_uri": "ut:lecture0t1:all-questions",
            "title": "UT Lecture 0 (from tutorial 1)",
        },
    ], utils.utQuestions).then(function (args) {
        try {
            quiz.setCurrentLecture({});
            t.fail();
        } catch (err) {
            t.equal(err.message, "lecUri parameter required");
        }

        quiz.setCurrentLecture({'lecUri': 'wibble'}).then(function () { t.fail(); }).catch(function (err) {
            t.equal(err.message, "Unknown lecture: wibble");
        });

        return quiz.setCurrentLecture({'lecUri': 'ut:lecture1'});
    }).then(function (args) {
        t.ok(quiz.isLectureSelected());
        t.equal(args.continuing, false); // No previous questions allocated
        t.equal(args.lecUri, 'ut:lecture1');
        t.equal(args.lecTitle, 'UT Lecture 1 (no answers)');

    // Can fetch from other tutorials
    }).then(function (args) {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0t1'});
    }).then(function (args) {
        t.equal(args.continuing, false); // No previous questions allocated
        t.equal(args.lecUri, 'ut:lecture0t1');
        t.equal(args.lecTitle, 'UT Lecture 0 (from tutorial 1)');

    // Continuing shows when currently in a practice or real question
    }).then(function (args) {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture-currentreal'});
    }).then(function (args) {
        t.equal(args.continuing, 'real');
        t.equal(args.lecUri, 'ut:lecture-currentreal');
        t.equal(args.lecTitle, 'UT Lecture: Currently real');
    }).then(function (args) {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture-currentpract'});
    }).then(function (args) {
        t.equal(args.continuing, 'practice');
        t.equal(args.lecUri, 'ut:lecture-currentpract');
        t.equal(args.lecTitle, 'UT Lecture: Currently practicing');

    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

test('_fetchSlides', function (t) {
    var ls = new MockLocalStorage(),
        aa = new MockAjaxApi(),
        promise,
        quiz = new Quiz(ls, aa),
        utils = test_utils();

    return insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial 0', [
        {
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
            "slide_uri": "http://slide-url-for-lecture0",
            "title": "UT Lecture 0 (no answers)",
        },
        {
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture1",
            "material_uri": "ut:lecture1:all-questions",
            "title": "UT Lecture 1 (no answers)",
        }
    ], utils.utQuestions).then(function () {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});

    // Can get a URL for lecture0
    }).then(function (args) {
        promise = quiz.fetchSlides();
        return aa.waitForQueue(["GET http://slide-url-for-lecture0 0"]);
    }).then(function (args) {
        aa.setResponse('GET http://slide-url-for-lecture0', 0, "<blink>hello</blink>");
        return promise;
    }).then(function (args) {
        // Returned our fake data
        t.deepEqual(args, "<blink>hello</blink>");

    // lecture1 doesn't have one
    }).then(function (args) {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture1'});
    }).then(function (args) {
        return quiz.fetchSlides().then(function () { t.fail(); }).catch(function (err) {
            t.equal(err, "tutorweb::error::No slides available!");
        });

    // Stop it and tidy up
    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

broken_test('_fetchReview', function (t) {
    var ls = new MockLocalStorage(),
        aa = new MockAjaxApi(),
        promise,
        quiz = new Quiz(ls, aa),
        utils = test_utils();

    return insertTutorial(quiz, 'ut:tutorial0', 'UT tutorial 0', [
        {
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
            "slide_uri": "http://slide-url-for-lecture0",
            "title": "UT Lecture 0 (no review URI)",
        },
        {
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture1",
            "material_uri": "ut:lecture1:all-questions",
            "review_uri": "http://review-url-for-lecture1",
            "title": "UT Lecture 1 (with a review)",
        }
    ], utils.utQuestions).then(function () {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture0'});

    // lecture0 doesn't have reviews
    }).then(function (args) {
        return quiz.fetchReview().then(function () { t.fail(); }).catch(function (err) {
            t.equal(err, "tutorweb::error::No review available!");
        });

    // lecture1 has a URL that can be fetched
    }).then(function (args) {
        return quiz.setCurrentLecture({'lecUri': 'ut:lecture1'});
    }).then(function (args) {
        promise = quiz.fetchReview();
        return aa.waitForQueue(["GET http://review-url-for-lecture1 0"]);
    }).then(function (args) {
        aa.setResponse('GET http://review-url-for-lecture1', 0, {camels: "yes"});
        return promise;
    }).then(function (args) {
        // Returned our fake data
        t.deepEqual(args, {camels: "yes"});

    // Stop it and tidy up
    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

test('_updateAward', function (t) {
    var ls = new MockLocalStorage(),
        aa = new MockAjaxApi(),
        quiz = new Quiz(ls, aa);

    return insertTutorial(quiz, 'ut://tutorial0/camels/badgers/thing', 'UT tutorial 0', [
        {
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
            "slide_uri": "http://slide-url-for-lecture0",
            "title": "UT Lecture 0 (no answers)",
        },
    ], {}).then(function (args) {
        return args;

    // Fetch without Smileycoin address
    }).then(function (args) {
        var promise = quiz.updateAward(null);
        t.deepEqual(aa.getQueue(), [
            'POST /api/coin/award 0',
        ]);
        aa.setResponse('POST /api/coin/award', 0, {"things": true});
        return promise;

    }).then(function (args) {
        // Returned our fake data
        t.deepEqual(args, {"things": true});
        return true;

    // Fetch with Smileycoin address, no captcha does the same
    }).then(function (args) {
        var promise = quiz.updateAward("WallEt");
        t.deepEqual(aa.getQueue(), [
            'POST /api/coin/award 1',
        ]);
        aa.setResponse('POST /api/coin/award', 1, {"things": true});
        return promise;

    }).then(function (args) {
        // Returned our fake data
        t.deepEqual(args, {"things": true});
        return true;

    // Fetch with Smileycoin address and captcha
    }).then(function (args) {
        var promise = quiz.updateAward("WaLlEt", "12345");
        t.deepEqual(aa.getQueue(), [
            'POST /api/coin/award 2',
        ]);
        t.deepEqual(
            aa.data['POST /api/coin/award 2'],
            {"walletId": 'WaLlEt', captchaResponse: '12345'}
        );
        aa.setResponse('POST /api/coin/award', 2, {"things": false});
        return promise;

    }).then(function (args) {
        // Returned our fake data
        t.deepEqual(args, {"things": false});
        return true;

    // Stop it and tidy up
    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

test('_updateUserDetails', function (t) {
    var ls = new MockLocalStorage(),
        aa = new MockAjaxApi(),
        quiz = new Quiz(ls, aa);

    return insertTutorial(quiz, 'ut://tutorial0/camels/badgers/thing', 'UT tutorial 0', [
        {
            "answerQueue": [],
            "questions": [ {"uri": "ut:question0", "chosen": 20, "correct": 100} ],
            "settings": {},
            "uri": "ut:lecture0",
            "material_uri": "ut:lecture0:all-questions",
            "slide_uri": "http://slide-url-for-lecture0",
            "title": "UT Lecture 0 (no answers)",
            "user": "brenda",
        },
    ], {}).then(function (args) {
        return args;

    // Fetch without data
    }).then(function (args) {
        var promise = quiz.updateUserDetails(null);
        t.deepEqual(aa.getQueue(), [
            'POST /api/student/details 0',
        ]);
        aa.setResponse('POST /api/student/details', 0, {"things": true});
        return promise;

    }).then(function (args) {
        // Returned our fake data
        t.deepEqual(args, {"things": true});
        return true;

    // Fetch with data
    }).then(function (args) {
        var promise = quiz.updateUserDetails({email: "bob@geldof.com"});
        t.deepEqual(aa.getQueue(), [
            'POST /api/student/details 1',
        ]);
        t.deepEqual(
            aa.data['POST /api/student/details 1'],
            {email: "bob@geldof.com"}
        );
        aa.setResponse('POST /api/student/details', 1, {"things": false});
        return promise;

    }).then(function (args) {
        // Returned our fake data
        t.deepEqual(args, {"things": false});
        return true;

    // Set the lecture, we start checking the username matches
    }).then(function (args) {
        return quiz.setCurrentLecture({ lecUri: 'ut:lecture0' });
    }).then(function (args) {
        var promise = quiz.updateUserDetails(null);
        t.deepEqual(aa.getQueue(), [
            'POST /api/student/details 2',
        ]);
        aa.setResponse('POST /api/student/details', 2, {"username": "barry"});
        return promise.then(function () { t.fail(); }).catch(function (err) {
            t.ok(err.message.indexOf("brenda") > -1);
        });

    }).then(function (args) {
        var promise = quiz.updateUserDetails(null);
        t.deepEqual(aa.getQueue(), [
            'POST /api/student/details 3',
        ]);
        aa.setResponse('POST /api/student/details', 3, {"username": "brenda"});
        return promise.then(function (details) {
            t.deepEqual(details.username, "brenda");
        });

    // Stop it and tidy up
    }).then(function (args) {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});
