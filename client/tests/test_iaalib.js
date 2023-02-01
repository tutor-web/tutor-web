"use strict";
/*jslint nomen: true, plusplus: true, todo: true*/
var test = require('tape');

var iaalib = new (require('../lib/iaa.js'))();
var shuffle = require('knuth-shuffle').knuthShuffle;
var seedrandom = require('seedrandom');

function exampleLec() {
    return {
        "answerQueue": [],
        "questions": [
            {"uri": "ut:question0", "chosen": 20, "correct": 100},
            {"uri": "ut:question1", "chosen": 40, "correct": 100},
            {"uri": "ut:question2", "chosen": 60, "correct": 100},
            {"uri": "ut:question3", "chosen": 80, "correct": 100},
            {"uri": "ut:question4", "chosen": 99, "correct": 100},
        ],
        "settings": {
            "hist_sel": 0,
        },
        "uri": "ut:lecture0",
    };
}

test('InitialAlloc', function (t) {
    // Allocate an initial item, should presume we started from 0
    var a = iaalib.newAllocation(exampleLec(), {practice: false});
    t.ok(a.uri.match(/ut:question[0-4]/));
    t.equal(a.grade_before, 0);
    t.deepEqual(a.student_answer, {});

    t.end();
});

test('EmptyLecture', function (t) {
    // Should complain if there's no items in a lecture
    try {
        iaalib.newAllocation({
            uri: "ut:lecture0",
            settings: {hist_sel: 0},
            answerQueue: [],
            questions: [],
        }, {});
    } catch (err) {
        t.ok(err.message.indexOf("no questions") > -1);
    }

    t.end();
});

test('ItemAllocation', function (t) {
    // Item allocation, on average, should hit the same point
    /** Build an answerQueue with x correct answers */
    function aq(correctAnswers) {
        var i, answerQueue = [];
        for (i = 0; i < Math.abs(correctAnswers); i++) {
            answerQueue.push({"correct": (correctAnswers > 0), "time_end": 1234});
        }
        return answerQueue;
    }

    /** Run allocation 1000 times, get mean question chosen*/
    function modalAllocation(qns, answerQueue, settings, practiceMode) {
        var uris = {}, i, alloc, grade = null, highScore, modalUri, uri;

        if (!settings) {
            settings = {"hist_sel" : "0"};
        }
        iaalib.gradeAllocation({}, answerQueue);
        for (i = 0; i < 7000; i++) {
            // Allocate a question based on answerQueue
            alloc = iaalib.newAllocation({
                "questions": qns,
                "settings": settings,
                "answerQueue": answerQueue,
            }, {practice: practiceMode || false});
            if (alloc === null) {
                t.ok(false, "failed to allocate qn");
            }
            // Count URIs
            if (uris.hasOwnProperty(alloc.uri)) {
                uris[alloc.uri] += 1;
            } else {
                uris[alloc.uri] = 1;
            }

            if (grade === null) {
                grade = alloc.grade_before;
            } else {
                if (alloc.grade_before !== grade) {
                    t.fail(alloc.grade_before + ' !== ' + grade);
                }
            }
        }

        // Find mode in uris
        highScore = -1;
        modalUri = '';
        for (uri in uris) {
            if (uris.hasOwnProperty(uri)) {
                if (uris[uri] > highScore) {
                    modalUri = uri;
                    highScore = uris[uri];
                }
            }
        }

        return {"alloc": modalUri, "grade": grade};
    }

    function between(res, min, max) {
        // Assuming question URI is an int, check it's between min & max

        if (parseInt(res, 10) < min) { return false; }
        if (parseInt(res, 10) > max) { return false; }
        return true;
    }

    // Start at grade 0, get easy question
    t.deepEqual(modalAllocation([
        {"uri": "0", "chosen": 100, "correct": 90},
        {"uri": "1", "chosen": 100, "correct": 80},
        {"uri": "2", "chosen": 100, "correct": 70},
        {"uri": "3", "chosen": 100, "correct": 60},
        {"uri": "4", "chosen": 100, "correct": 50},
        {"uri": "5", "chosen": 100, "correct": 40},
        {"uri": "6", "chosen": 100, "correct": 30},
        {"uri": "7", "chosen": 100, "correct": 20},
        {"uri": "8", "chosen": 100, "correct": 10},
    ], aq(0)), {"alloc": "0", "grade": 0});

    // Start at grade 0, still get easy question when we jumble them up
    t.deepEqual(modalAllocation([
        {"uri": "0", "chosen": 100, "correct": 10},
        {"uri": "1", "chosen": 100, "correct": 90},
        {"uri": "2", "chosen": 100, "correct": 20},
        {"uri": "3", "chosen": 100, "correct": 80},
        {"uri": "4", "chosen": 100, "correct": 30},
        {"uri": "5", "chosen": 100, "correct": 70},
        {"uri": "6", "chosen": 100, "correct": 40},
        {"uri": "7", "chosen": 100, "correct": 60},
        {"uri": "8", "chosen": 100, "correct": 50},
    ], aq(0)), {"alloc": "1", "grade": 0});
    t.deepEqual(modalAllocation(shuffle([
        {"uri": "0", "chosen": 100, "correct": 10},
        {"uri": "1", "chosen": 100, "correct": 90},
        {"uri": "2", "chosen": 100, "correct": 20},
        {"uri": "3", "chosen": 100, "correct": 80},
        {"uri": "4", "chosen": 100, "correct": 30},
        {"uri": "5", "chosen": 100, "correct": 70},
        {"uri": "6", "chosen": 100, "correct": 40},
        {"uri": "7", "chosen": 100, "correct": 60},
        {"uri": "8", "chosen": 100, "correct": 50},
    ]), aq(0)), {"alloc": "1", "grade": 0});

    // Answer loads of questions correctly, get a hard question
    t.deepEqual(modalAllocation([
        {"uri": "0", "chosen": 100, "correct": 90},
        {"uri": "1", "chosen": 100, "correct": 80},
        {"uri": "2", "chosen": 100, "correct": 70},
        {"uri": "3", "chosen": 100, "correct": 60},
        {"uri": "4", "chosen": 100, "correct": 50},
        {"uri": "5", "chosen": 100, "correct": 40},
        {"uri": "6", "chosen": 100, "correct": 30},
        {"uri": "7", "chosen": 100, "correct": 20},
        {"uri": "8", "chosen": 100, "correct": 10},
    ], aq(10)), {"alloc": "8", "grade": 10});

    // Answer some questions correctly, get a middling question
    t.ok(between(modalAllocation([
        {"uri": "0", "chosen": 100, "correct": 90},
        {"uri": "1", "chosen": 100, "correct": 80},
        {"uri": "2", "chosen": 100, "correct": 70},
        {"uri": "3", "chosen": 100, "correct": 60},
        {"uri": "4", "chosen": 100, "correct": 50},
        {"uri": "5", "chosen": 100, "correct": 40},
        {"uri": "6", "chosen": 100, "correct": 30},
        {"uri": "7", "chosen": 100, "correct": 20},
        {"uri": "8", "chosen": 100, "correct": 10},
    ], aq(4)), 4, 6));

    // Our grade won't go beyond 10, still get hard questions
    t.deepEqual(modalAllocation([
        {"uri": "0", "chosen": 100, "correct": 90},
        {"uri": "1", "chosen": 100, "correct": 80},
        {"uri": "2", "chosen": 100, "correct": 70},
        {"uri": "3", "chosen": 100, "correct": 60},
        {"uri": "4", "chosen": 100, "correct": 50},
        {"uri": "5", "chosen": 100, "correct": 40},
        {"uri": "6", "chosen": 100, "correct": 30},
        {"uri": "7", "chosen": 100, "correct": 20},
        {"uri": "8", "chosen": 100, "correct": 10},
    ], aq(20)), {"alloc": "8", "grade": 10});

    // A new question is allocated to us if we're doing well.
    t.deepEqual(modalAllocation([
        {"uri": "0", "chosen": 100, "correct": 90},
        {"uri": "1", "chosen": 100, "correct": 80},
        {"uri": "2", "chosen": 100, "correct": 70},
        {"uri": "3", "chosen": 100, "correct": 60},
        {"uri": "4", "chosen": 100, "correct": 50},
        {"uri": "5", "chosen": 100, "correct": 40},
        {"uri": "6", "chosen": 100, "correct": 30},
        {"uri": "7", "chosen": 100, "correct": 20},
        {"uri": "8", "chosen": 100, "correct": 10},
        {"uri": "N", "chosen": 1, "correct": 1},
    ], aq(20)), {"alloc": "N", "grade": 10});

    // ..even if we're doing badly
    t.deepEqual(modalAllocation([
        {"uri": "0", "chosen": 100, "correct": 90},
        {"uri": "1", "chosen": 100, "correct": 80},
        {"uri": "2", "chosen": 100, "correct": 70},
        {"uri": "3", "chosen": 100, "correct": 60},
        {"uri": "4", "chosen": 100, "correct": 50},
        {"uri": "5", "chosen": 100, "correct": 40},
        {"uri": "6", "chosen": 100, "correct": 30},
        {"uri": "7", "chosen": 100, "correct": 20},
        {"uri": "8", "chosen": 100, "correct": 10},
        {"uri": "N", "chosen": 1, "correct": 1},
    ], aq(-5)), {"alloc": "N", "grade": 0});

    // .. I said, even if we're doing badly.
    t.deepEqual(modalAllocation([
        {"uri": "0", "chosen": 100, "correct": 50},
        {"uri": "1", "chosen": 100, "correct": 40},
        {"uri": "2", "chosen": 100, "correct": 30},
        {"uri": "3", "chosen": 100, "correct": 20},
        {"uri": "4", "chosen": 100, "correct": 10},
        {"uri": "N", "chosen": 3, "correct": 0},
    ], aq(0)), {"alloc": "N", "grade": 0});

    // Don't get the same question immediately after
    t.ok(["0", "2"].indexOf(modalAllocation([
        {"uri": "0", "chosen": 100, "correct": 70},
        {"uri": "2", "chosen": 100, "correct": 50},
        {"uri": "4", "chosen": 100, "correct": 10},
        {"uri": "6", "chosen": 100, "correct": 10},
        {"uri": "8", "chosen": 100, "correct": 10},
    ], [
        {"uri": "8", "correct": true},  // NB: Just to ensure grade is correct
    ]).alloc) !== -1);
    t.ok(["0", "4"].indexOf(modalAllocation([
        {"uri": "0", "chosen": 100, "correct": 70},
        {"uri": "2", "chosen": 100, "correct": 50},
        {"uri": "4", "chosen": 100, "correct": 10},
        {"uri": "6", "chosen": 100, "correct": 10},
        {"uri": "8", "chosen": 100, "correct": 10},
    ], [
        {"uri": "2", "correct": true},
    ]).alloc) !== -1);


    t.end();
});

test('ItemAllocationPracticeMode', function (t) {
    // Item allocation passes through practice mode
    var alloc;
    alloc = iaalib.newAllocation(exampleLec(), {practice: false});
    t.equal(alloc.student_answer.practice, undefined, "Practice mode not in allocation");

    alloc = iaalib.newAllocation(exampleLec(), {practice: true});
    t.equal(alloc.student_answer.practice, true, "Practice mode not in allocation");

    t.end();
});

test('ForceAllocation', function (t) {
    var a;

    // We can force which question comes back with question_uri
    a = iaalib.newAllocation(exampleLec(), {practice: false, question_uri: "ut:question0"});
    t.equal(a.uri, "ut:question0");
    t.equal(a.student_answer.practice, undefined);
    a = iaalib.newAllocation(exampleLec(), {practice: true, question_uri: "ut:question1"});
    t.equal(a.uri, "ut:question1");
    t.equal(a.student_answer.practice, true);
    a = iaalib.newAllocation(exampleLec(), {practice: false, question_uri: "ut:question2?some_opts=yes"});
    t.equal(a.uri, "ut:question2?some_opts=yes");
    t.equal(a.student_answer.practice, undefined);

    // Unknown question generates error
    try {
        a = iaalib.newAllocation(exampleLec(), {practice: false, question_uri: "ut:not-a-question"});
        t.fail();
    } catch (err) {
        t.ok(err.message.indexOf("ut:not-a-question") > -1);
    }

    t.end();
});

test('HistSel', function (t) {
    var a;

    // Fix random seed
    seedrandom('9933sdrfseed', {global: true});

    // If there's no historical questions to use, hist_sel will be ignored
    a = iaalib.newAllocation({ uri: "ut:lecture0", settings: {hist_sel: 1}, answerQueue: [], questions: [
        {"uri": "0", "chosen": 100, "correct": 10},
        {"uri": "1", "chosen": 100, "correct": 20},
        {"uri": "2", "chosen": 100, "correct": 30},
    ]}, {});
    t.ok(["0", "1", "2"].indexOf(a.uri) > 0);

    // If hist_sel is 0 then historical questions will be ignored.
    a = iaalib.newAllocation({ uri: "ut:lecture0", settings: {hist_sel: 0}, answerQueue: [{"grade_after": 0}], questions: [
        {"uri": "0", "chosen": 100, "correct": 10},
        {"_type": "historical", "uri": "5", "chosen": 100, "correct":  1},
        {"_type": "historical", "uri": "6", "chosen": 100, "correct": 10},
        {"_type": "historical", "uri": "7", "chosen": 100, "correct": 50},
        {"_type": "historical", "uri": "8", "chosen": 100, "correct": 70},
        {"_type": "historical", "uri": "9", "chosen": 100, "correct": 99}
    ]}, {});
    t.equal(a.uri, "0");

    // Choose a historical question, based on your current grade
    // NB: We probably want to remove this behaviour post-2016, it's illogical but being preserved for experiment
    a = iaalib.newAllocation({ uri: "ut:lecture0", settings: {hist_sel: 1}, answerQueue: [{"grade_after": 0}], questions: [
        {"uri": "0", "chosen": 100, "correct": 10},
        {"uri": "1", "chosen": 100, "correct": 20},
        {"uri": "2", "chosen": 100, "correct": 30},
        {"uri": "3", "chosen": 100, "correct": 40},
        {"uri": "4", "chosen": 100, "correct": 50},
        {"_type": "historical", "uri": "5", "chosen": 100, "correct":  1},
        {"_type": "historical", "uri": "6", "chosen": 100, "correct": 10},
        {"_type": "historical", "uri": "7", "chosen": 100, "correct": 50},
        {"_type": "historical", "uri": "8", "chosen": 100, "correct": 70},
        {"_type": "historical", "uri": "9", "chosen": 100, "correct": 99}
    ]}, {});
    t.equal(a.uri, "9");
    a = iaalib.newAllocation({ uri: "ut:lecture0", settings: {hist_sel: 1}, answerQueue: [{"grade_after": 9}], questions: [
        {"uri": "0", "chosen": 100, "correct": 10},
        {"uri": "1", "chosen": 100, "correct": 20},
        {"uri": "2", "chosen": 100, "correct": 30},
        {"uri": "3", "chosen": 100, "correct": 40},
        {"uri": "4", "chosen": 100, "correct": 50},
        {"_type": "historical", "uri": "5", "chosen": 100, "correct":  1},
        {"_type": "historical", "uri": "6", "chosen": 100, "correct": 20},
        {"_type": "historical", "uri": "7", "chosen": 100, "correct": 50},
        {"_type": "historical", "uri": "8", "chosen": 100, "correct": 80},
        {"_type": "historical", "uri": "9", "chosen": 100, "correct": 99}
    ]}, {});
    t.equal(a.uri, "5");

    t.end();
});

test('QuestionDistribution', function (t) {
    var defaultQns = [
        {"uri": "0", "chosen": 100, "correct": 10},
        {"uri": "1", "chosen": 100, "correct": 20},
        {"uri": "2", "chosen": 100, "correct": 30},
        {"uri": "3", "chosen": 100, "correct": 40},
        {"uri": "4", "chosen": 100, "correct": 50},
        {"uri": "5", "chosen": 100, "correct": 60},
        {"uri": "6", "chosen": 100, "correct": 70},
        {"uri": "7", "chosen": 100, "correct": 80},
        {"uri": "8", "chosen": 100, "correct": 90},
        {"uri": "9", "chosen": 100, "correct": 99}
    ];

    function questionOrder() {
        var i, dist, prevProb = 0, total = 0, qnOrder = [];
        dist = iaalib.questionDistribution.apply(iaalib, arguments);
        for (i = 0; i < dist.length; i++) {
            t.ok(dist[i].probability >= prevProb);
            prevProb = dist[i].probability;
            total += dist[i].probability;
            qnOrder.unshift(dist[i].qn.uri);
        }
        t.ok(Math.abs(total - 1) < 0.00001);

        return qnOrder;
    }

    // Previous items get weighted down
    t.deepEqual(
        questionOrder(defaultQns, 3, []),
        ['7', '6', '8', '5', '4', '9', '3', '2', '1', '0']
    );
    t.deepEqual(
        questionOrder(defaultQns, 3, [{"uri": "6", "correct": true}]),
        ['7', '8', '5', '4', '9', '3', '2', '1', '6', '0']
    );

    // Old incorrect questions get boosted
    t.deepEqual(
        questionOrder(defaultQns, 3, [
            {"uri": "3", "correct": false},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
        ]),
        ['3', '7', '6', '8', '5', '4', '9', '2', '1', '0']
    );

    // A new answer overrides this boosting
    t.deepEqual(
        questionOrder(defaultQns, 3, [
            {"uri": "3", "correct": false},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "0", "correct": true},
            {"uri": "3", "correct": true},
        ]),
        ['7', '6', '8', '5', '4', '9', '2', '1', '3', '0']
    );

    // Can add extras, dist still correct (i.e. adds up to 1)
    t.deepEqual(
        questionOrder(defaultQns, 3, [], [
            {_type: "template", uri: "t0"},
            {_type: "template", uri: "t1"},
            {_type: "template", uri: "t2"},
        ], 0.2),
        ['7', '6', '8', '5', '4', '9', '3', '2', 't2', 't1', 't0', '1', '0']
    );

    // Can boost their probability
    t.deepEqual(
        questionOrder(defaultQns, 3, [], [
            {_type: "template", uri: "t0"},
            {_type: "template", uri: "t1"},
            {_type: "template", uri: "t2"},
        ], 0.25),
        ['7', '6', '8', '5', '4', 't2', 't1', 't0', '9', '3', '2', '1', '0']
    );

    // Or hide them entirely
    t.deepEqual(
        questionOrder(defaultQns, 3, [], [
            {_type: "template", uri: "t0"},
            {_type: "template", uri: "t1"},
            {_type: "template", uri: "t2"},
        ], 0),
        ['7', '6', '8', '5', '4', '9', '3', '2', '1', '0']
    );

    // Assigned probability adds up
    iaalib.questionDistribution(defaultQns, 3, [], [
        {_type: "template", uri: "t0"},
        {_type: "template", uri: "t1"},
        {_type: "template", uri: "t2"},
    ], 0.2).filter(function (d) { return d.qn._type === "template"; }).map(function (d) {
        t.ok(Math.abs(d.probability - (0.2 / 3)) < 0.0001);
    });
    iaalib.questionDistribution(defaultQns, 3, [], [
        {_type: "template", uri: "t0"},
        {_type: "template", uri: "t1"},
    ], 0.6).filter(function (d) { return d.qn._type === "template"; }).map(function (d) {
        t.ok(Math.abs(d.probability - (0.6 / 2)) < 0.0001);
    });

    // Test gpow has an effect on the distribution
    t.deepEqual(
        iaalib.questionDistribution(defaultQns, 3, [], [], 0, {iaa_adaptive_gpow: '0.5'}).map(function (d) { return [d.qn.uri, Math.round(d.probability * 1000) / 1000]; }),
        [
            [ '9', 0.061 ], [ '0', 0.076 ], [ '8', 0.085 ], [ '1', 0.099 ], [ '7', 0.101 ],
            [ '2', 0.111 ], [ '6', 0.111 ], [ '5', 0.117 ], [ '3', 0.118 ], [ '4', 0.120 ],
        ]
    );
    t.deepEqual(
        iaalib.questionDistribution(defaultQns, 3, [], [], 0, {iaa_adaptive_gpow: '1.5'}).map(function (d) { return [d.qn.uri, Math.round(d.probability * 1000) / 1000]; }),
        [
            [ '0', 0.029 ], [ '1', 0.051 ], [ '2', 0.071 ], [ '3', 0.088 ], [ '4', 0.103 ],
            [ '5', 0.117 ], [ '6', 0.128 ], [ '7', 0.136 ], [ '9', 0.137 ], [ '8', 0.141 ],
        ]
    );

    t.end();
});

test('QuestionStudyTime', function (t) {
    var corrects = [];

    function qst(studyTimeFactor, studyTimeAnsweredFactor, studyTimeMax, corrects, finalLecAnswered) {
        var aq = corrects.map(function (c, i) {
            return {
                correct: c,
                lec_answered: i, //NB: These values should be ignored
            };
        });

        if (finalLecAnswered && aq.length > 0) {
            aq[aq.length - 1].lec_answered = finalLecAnswered;
        }

        return iaalib.questionStudyTime({
            'studytime_factor': studyTimeFactor.toString(),
            'studytime_answeredfactor': studyTimeAnsweredFactor.toString(),
            'studytime_max': studyTimeMax.toString(),
        }, aq);
    }

    // Empty aq = no delay
    t.equal(qst(2, "", 20, []), 0);

    // defaults are 2 and 20
    t.equal(qst("", "", "", [false]), 2);
    t.equal(qst("", "", "",
        [false, false, false, false, false, false, false, false, false, false, false, false]), 20);

    // Can be overriden
    t.equal(qst(3, "", 10,
        [false]), 3);
    t.equal(qst(3, "", 10,
        [false, false, false, false, false, false, false, false, false, false, false, false]), 10);

    // A correct answer resets the count
    corrects = [false, false];
    t.equal(qst(2, "", 20, corrects), 4);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 6);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 8);
    corrects.push(true);
    t.equal(qst(2, "", 20, corrects), 0);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 2);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 4);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 6);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 8);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 10);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 12);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 14);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 16);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 18);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 20);
    corrects.push(false);
    t.equal(qst(2, "", 20, corrects), 20);
    corrects.push(true);
    t.equal(qst(2, "", 20, corrects), 0);

    // correct === null doesn't count as an incorrect answer
    t.equal(qst(2, "", 20, [true, false, null]), 0);
    t.equal(qst(2, "", 20, [true, false, null, false]), 2);

    // AnsweredFactor by default does nothing
    t.equal(qst("", "", "", [], 20), 0);
    t.equal(qst("", "", "", [false], 20), 2);
    t.equal(qst("", "", "", [false], 40), 2);

    // Turning it on increments delay by questions answered
    t.equal(qst("", "0.2", "", [false], 20), 2 + 0.2 * 20);
    t.equal(qst("", "0.2", "", [false], 40), 2 + 0.2 * 40);
    t.equal(qst("", "0.3", "", [false], 40), 2 + 0.3 * 40);

    // Answer queue length isn't used, only the last lec_answered
    t.equal(qst("", "0.3", "", [], 40), 0);
    t.equal(qst("", "0.3", "", [true], 40), 0.3 * 40);
    t.equal(qst("", "0.3", "", [true, true], 40), 0.3 * 40);
    t.equal(qst("", "0.3", "", [true, true], 40), 0.3 * 40);
    t.equal(qst("", "0.3", "", [true, true, false], 40), 2 + 0.3 * 40);

    // We delay even if they got the question right
    t.equal(qst("", "0.3", "", [false, true], 40), 0.3 * 40);
    t.equal(qst("", "0.3", "", [true, null], 40), 0.3 * 40);

    t.end();
});

test('ChooseQuestion', function (t) {
    // Can't choose questions from an empty set
    t.deepEqual(iaalib.chooseQuestion([]), null);

    t.end();
});

test('Weighting', function (t) {
    var i;

    function weighting(n, alpha, s, nmin, nmax) {
        var j,
            total = 0,
            weightings = iaalib.gradeWeighting(n, alpha, s, nmin || 8, nmax || 30);
        // Should have at least 1 thing to grade
        if (n === 0) { return []; }

        // Should always sum to 1
        for (j = 0; j < weightings.length; j++) {
            total += weightings[j];
        }
        if (n > 1) {
            t.ok(total > 0.99999 && total < 1.000001, total);
        }

        // Squish down to 4dp for comparison
        return weightings.map(function (x) {
            return x.toFixed(4);
        });
    }

    // Asking for one weighting gives you 8
    t.deepEqual(weighting(1, 0.5, 2), [
        '0.5000', '0.1750', '0.1286', '0.0893',
        '0.0571', '0.0321', '0.0143', '0.0036']);
    t.deepEqual(weighting(5, 0.3, 2), [
        '0.3500', '0.2571', '0.1786', '0.1143',
        '0.0643', '0.0286', '0.0071', '0.0000']);

    // Curve small enough for alpha to go at beginning, truncate at 30
    t.deepEqual(weighting(50, 0.5, 2), [
        '0.5000', '0.0492', '0.0458', '0.0426',
        '0.0395', '0.0365', '0.0337', '0.0309',
        '0.0283', '0.0258', '0.0234', '0.0211',
        '0.0189', '0.0169', '0.0150', '0.0132',
        '0.0115', '0.0099', '0.0084', '0.0071',
        '0.0058', '0.0047', '0.0037', '0.0029',
        '0.0021', '0.0015', '0.0009', '0.0005',
        '0.0002', '0.0001']);

    // If it rises beyond alpha, don't use it
    t.deepEqual(weighting(5, 0.2, 2), [
        '0.3500', '0.2571', '0.1786', '0.1143',
        '0.0643', '0.0286', '0.0071', '0.0000']);

    // Length should be either i or 30
    t.deepEqual(weighting(0, 0.5, 2), []);
    t.deepEqual(weighting(0, 0.3, 2), []);
    for (i = 1; i < 50; i++) {
        t.equal(weighting(i, 0.5, 2).length, Math.min(Math.max(i, 8), 30));
        t.equal(weighting(i, 0.3, 2).length, Math.min(Math.max(i, 8), 30));
    }

    // s = 0 is a special case
    t.deepEqual(weighting(5, 0.1, 0), [
        '0.1429', '0.1429', '0.1429', '0.1429',
        '0.1429', '0.1429', '0.1429', '0.0000']);
    t.deepEqual(weighting(5, 0.2, 0), [
        '0.2000', '0.1143', '0.1143', '0.1143',
        '0.1143', '0.1143', '0.1143', '0.1143']);

    // Floating-point nmin and nmax don't faze us.
    t.deepEqual(weighting(1, 0.5, 2, 8.4, 22.241).length, 8);
    t.deepEqual(weighting(30, 0.5, 2, 8.4, 22.241).length, 22);

    t.end();
});

test('Grading', function (t) {
    function grade(queue, settings) {
        var i, answerQueue = [];

        for (i = 0; i < queue.length; i++) {
            answerQueue.push(queue[i]);
            iaalib.gradeAllocation(settings || {}, answerQueue);
        }

        return answerQueue[answerQueue.length - 1];
    }

    // Generate a very long string of answers, some should be ignored
    var i, longGrade = [];
    for (i = 0; i < 200; i++) {
        longGrade.push({
            "correct": (Math.random() < 0.5),
            "practice": false,
        });
    }

    // grade_next_right should be consistent with what comes after
    [
        [
            {"correct": false, "practice": false, "time_end": 1234},
        ], [
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": false, "practice": false, "time_end": 1234},
            {"correct": false, "practice": false, "time_end": 1234},
        ], [
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": false, "practice": false, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": false, "practice": false, "time_end": 1234},
        ], [
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": false, "practice": false, "time_end": 1234},
            {"correct": false, "practice": false, "time_end": 1234},
            {"correct": false, "practice": false, "time_end": 1234},
            {"correct": false, "practice": false, "time_end": 1234},
        ], longGrade
    ].map(function (answerQueue) {
        t.equal(
            grade(answerQueue).grade_next_right,
            grade(answerQueue.concat([
                {"correct": true, "practice": false, "time_end": 1234},
            ])).grade_after
        );
    });

    // Unanswered questions should be ignored
    t.ok(!grade([{"correct": false, "practice": false, "time_end": 1234}, {"grade_before": 0}].hasOwnProperty('grade_after')));
    t.ok(!grade([{"correct": false, "practice": false, "time_end": 1234}, {}].hasOwnProperty('grade_next_right')));

    // No answers returns nothing
    (function () {
        var aq = [];
        iaalib.gradeAllocation({}, []);
        t.deepEqual(aq, []);
    }());

    // One incorrect answer should be 0
    t.equal(grade([
        {"correct": false, "time_end": 1234},
    ]).grade_after, 0);

    // One or two correct answers give us a higher score, but not the maximum
    t.ok(grade([{"correct": true, "time_end": 1234}]).grade_after > 0);
    t.ok(grade([{"correct": true, "time_end": 1234}]).grade_after < 10);
    t.ok(grade([{"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}]).grade_after > 0);
    t.ok(grade([{"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}]).grade_after < 10);

    // Grade shouldn't fall below 0
    t.equal(grade([
        {"correct": false, "practice": false, "time_end": 1234},
        {"correct": false, "practice": false, "time_end": 1234},
        {"correct": false, "practice": false, "time_end": 1234},
        {"correct": false, "practice": false, "time_end": 1234},
        {"correct": false, "practice": false, "time_end": 1234},
        {"correct": false, "practice": false, "time_end": 1234},
        {"correct": false, "practice": false, "time_end": 1234},
        {"correct": false, "practice": false, "time_end": 1234},
    ]).grade_after, 0);

    // Unanswered question gets "grade_before" instead
    t.deepEqual(grade([
        {"correct": true, "practice": false, "time_end": 1234},
        {"correct": true, "practice": false, "time_end": 1234},
        {"practice": false},
    ]), {
        "practice": false,
        "grade_before": grade([{"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}]).grade_after,
        "grade_next_right": grade([{"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}]).grade_after,
    });

    // By default, alpha is 0.3 (which should be your grade with one correct answer)
    t.equal(
        grade([{"correct": true, "time_end": 1234}], {}).grade_after,
        Math.max(Math.round(iaalib.gradeWeighting(1, 0.125, 2, 8, 30)[0] * 40) / 4, 0)
    );
    t.equal(
        grade([{"correct": true, "time_end": 1234}], {}).grade_after,
        grade([{"correct": true, "time_end": 1234}], {"grade_alpha" : 0.125}).grade_after
    );
    t.notEqual(
        grade([{"correct": true, "time_end": 1234}], {}).grade_after,
        grade([{"correct": true, "time_end": 1234}], {"grade_alpha" : 0.5}).grade_after
    );
    t.equal(
        grade([{"correct": true, "time_end": 1234}], {"grade_alpha" : 0.5}).grade_after,
        Math.max(Math.round(iaalib.gradeWeighting(1, 0.5, 2, 8, 30)[0] * 40) / 4, 0)
    );
    t.equal(
        grade([{"correct": true, "time_end": 1234}], {"grade_alpha" : 0.2}).grade_after,
        Math.max(Math.round(iaalib.gradeWeighting(1, 0.2, 2, 8, 30)[0] * 40) / 4, 0)
    );

    // By default, s is 2
    t.equal(
        grade([{"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}], {"grade_alpha" : 0.3}).grade_after,
        grade([{"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}], {"grade_alpha" : 0.3, "grade_s" : 2}).grade_after
    );
    t.notEqual(
        grade([{"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}], {"grade_alpha" : 0.3, "grade_s" : 2}).grade_after,
        grade([{"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}], {"grade_alpha" : 0.3, "grade_s" : 5}).grade_after
    );

    // Grade generally goes up.
    (function () {
        var j,
            curGrade = 0,
            answers = [
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": false, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
                {"correct": true, "time_end": 1234},
            ];
        /*jslint unparam: true*/
        answers.map(function (a, i) {
            var aq = answers.slice(0, i + 1);
            iaalib.gradeAllocation({"grade_alpha" : 0.154, "grade_s": 1}, aq);
        });
        /*jslint unparam: false*/

        for (j = 0; j < answers.length; j++) {
            t.ok(answers[j].correct
                   ? answers[j].grade_after >= curGrade
                   : answers[j].grade_after < curGrade);
            curGrade = answers[j].grade_after;
        }
    }());

    t.end();
});

test('GradingPracticeMode', function (t) {
    function grade(queue) {
        var i, answerQueue = [];

        for (i = 0; i < queue.length; i++) {
            // NB: Fix up tests for new practice world-order
            if (queue[i].practice) {
                queue[i].student_answer = {
                    practice: true,
                    practice_correct: queue[i].correct,
                };
                queue[i].correct = null;
            }
            answerQueue.push(queue[i]);
            iaalib.gradeAllocation({}, answerQueue);
        }

        return answerQueue[answerQueue.length - 1];
    }

    // All practice mode should leave you with a grade of 0
    t.equal(grade([
        {"correct": true, "practice": true, "time_end": 1234},
        {"correct": false, "practice": true, "time_end": 1234},
        {"correct": true, "practice": true, "time_end": 1234},
        {"correct": false, "practice": true, "time_end": 1234},
        {"correct": true, "practice": true, "time_end": 1234},
    ]).grade_after, 0);

    // Practice mode shouldn't affect score
    t.equal(
        grade([
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": false, "practice": false, "time_end": 1234},
            {"correct": false, "practice": true, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
        ]).grade_after,
        grade([
            {"correct": false, "practice": false, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
        ]).grade_after
    );

    t.equal(
        grade([
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": false, "practice": false, "time_end": 1234},
            {"correct": false, "practice": true, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": true, "practice": true, "time_end": 1234},
            {"correct": true, "practice": true, "time_end": 1234},
        ]).grade_after,
        grade([
            {"correct": false, "practice": false, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
        ]).grade_after
    );

    // If practice question is latest, just rabbit same grade again.
    t.ok(grade([{"correct": true, "time_end": 1234}]).grade_after > 0);
    t.deepEqual(grade([
        {"correct": true, "practice": false, "time_end": 1234},
        {"practice": true},
    ]), {
        "practice": true,
        "student_answer": { practice: true, practice_correct: undefined },
        "correct": null,
        "grade_before": grade([{"correct": true, "time_end": 1234}]).grade_after,
        "grade_next_right": grade([{"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}]).grade_after,
    });
    t.deepEqual(grade([
        {"correct": true, "practice": false, "time_end": 1234},
        {"correct": true, "practice": true, "time_end": 1234},
    ]), {
        "practice": true,
        "student_answer": { practice: true, practice_correct: true },
        "correct": null,
        "time_end": 1234,
        "grade_after": grade([{"correct": true, "time_end": 1234}]).grade_after,
        "grade_next_right": grade([{"correct": true, "time_end": 1234}, {"correct": true, "time_end": 1234}]).grade_after,
    });

    // missing correct shouldn't have any affect on grade either
    t.equal(
        grade([
            {"correct": null, "time_end": 1234},
            {"correct": null, "time_end": 1234},
            {"correct": null, "time_end": 1234},
            {"correct": null, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": null, "time_end": 1234},
            {"correct": null, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
        ]).grade_after,
        grade([
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
        ]).grade_after
    );
    t.equal(
        grade([
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": null, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": null},
            {},
        ]).grade_before,
        grade([
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
            {"correct": true, "practice": false, "time_end": 1234},
        ]).grade_after
    );

    t.end();
});

test('gradeAllocation:scorrect', function (t) {
    var settings = {
        grade_algorithm: "scorrect",
        grade_s: 3,
    };

    function grade(queue) {
        var i, answerQueue = [];

        for (i = 0; i < queue.length; i++) {
            answerQueue.push(queue[i]);
            iaalib.gradeAllocation(settings, answerQueue);
        }

        return answerQueue[answerQueue.length - 1];
    }

    // Get full marks if you get (grade_s) items correct
    t.equal(grade([
        {"correct": true, "time_end": 1234},
    ]).grade_after, 3.33);
    t.equal(grade([
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
    ]).grade_after, 6.67);
    t.equal(grade([
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
    ]).grade_after, 10);

    // Extra incorrect answers make no difference
    t.equal(grade([
        {"correct": false, "time_end": 1234},
    ]).grade_after, 0);
    t.equal(grade([
        {"correct": false, "time_end": 1234},
        {"correct": true, "time_end": 1234},
        {"correct": false, "time_end": 1234},
        {"correct": false, "time_end": 1234},
        {"correct": true, "time_end": 1234},
    ]).grade_after, 6.67);

    // grade_s can be altered
    settings.grade_s = 5;
    t.equal(grade([
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
    ]).grade_after, 4);
    t.equal(grade([
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
    ]).grade_after, 8);
    t.equal(grade([
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
        {"correct": true, "time_end": 1234},
    ]).grade_after, 10);

    t.end();
});

test('Timeout', function (t) {
    // No / zero settings get no timeout
    t.equal(iaalib.qnTimeout({
    }, 0), null);
    t.equal(iaalib.qnTimeout({
        "timeout_min": "3",
    }, 0), null);
    t.equal(iaalib.qnTimeout({
        "timeout_max": "3",
    }, 0), null);

    // Low grades get the tMax
    t.equal(iaalib.qnTimeout({
        "timeout_min": "3",
        "timeout_max": "7",
        "timeout_grade": "5",
        "timeout_std": "0.5",
    }, 0) / 60, 7);
    t.equal(iaalib.qnTimeout({
        "timeout_min": "13",
        "timeout_max": "27",
        "timeout_grade": "10",
        "timeout_std": "0.5",
    }, 0) / 60, 27);

    // High grades get the tMax
    t.equal(iaalib.qnTimeout({
        "timeout_min": "3",
        "timeout_max": "7",
        "timeout_grade": "5",
        "timeout_std": "0.5",
    }, 10) / 60, 7);
    t.equal(iaalib.qnTimeout({
        "timeout_min": "13",
        "timeout_max": "27",
        "timeout_grade": "10",
        "timeout_std": "0.5",
    }, 20) / 60, 27);

    // Middle grades get the tMin
    t.equal(iaalib.qnTimeout({
        "timeout_min": "3",
        "timeout_max": "7",
        "timeout_grade": "5",
        "timeout_std": "0.5",
    }, 5) / 60, 3);
    t.equal(iaalib.qnTimeout({
        "timeout_min": "13",
        "timeout_max": "27",
        "timeout_grade": "8",
        "timeout_std": "0.5",
    }, 8) / 60, 13);

    t.end();
});

test('markAnswer', function (t) {
    var a;

    // We always give a null grade if no marking scheme given
    t.equal(iaalib.markAnswer({student_answer: {}}, {}), null);
    t.equal(iaalib.markAnswer({student_answer: {correct: ["yes"]}}, {}), null);

    // Otherwise, all parts are checked
    t.equal(iaalib.markAnswer({student_answer: {correct: "no"}}, {correct: ["yes"]}), false);
    t.equal(iaalib.markAnswer({student_answer: {correct: "yes"}}, {correct: ["yes"]}), true);
    t.equal(iaalib.markAnswer({student_answer: {correct: "yes", also_correct: "no"}}, {correct: ["yes"]}), true);
    t.equal(iaalib.markAnswer({student_answer: {correct: "yes", also_correct: "no"}}, {correct: ["yes"], also_correct: ["yes"]}), false);
    t.equal(iaalib.markAnswer({student_answer: {correct: "yes", also_correct: "yes"}}, {correct: ["yes"], also_correct: ["yes"]}), true);

    // Answer specifications can be integers
    t.equal(iaalib.markAnswer({student_answer: {correct: "5"}}, {correct: [2]}), false);
    t.equal(iaalib.markAnswer({student_answer: {correct: "5"}}, {correct: [5]}), true);
    t.equal(iaalib.markAnswer({student_answer: {correct: "5   "}}, {correct: [5]}), true);

    // Can use the non-empty function
    t.equal(iaalib.markAnswer({student_answer: {}}, {correct: {nonempty: 1}}), false);
    t.equal(iaalib.markAnswer({student_answer: {correct: ""}}, {correct: {nonempty: 1}}), false);
    t.equal(iaalib.markAnswer({student_answer: {correct: "maybe"}}, {correct: {nonempty: 1}}), true);
    t.equal(iaalib.markAnswer({student_answer: {correct: "no"}}, {correct: {nonempty: 1}}), true);

    // Can set '_start_with' to choose correct grade
    t.equal(iaalib.markAnswer({student_answer: {correct: "no"}}, {correct: ["yes"], _start_with: null}), false);
    t.equal(iaalib.markAnswer({student_answer: {correct: "yes"}}, {correct: ["yes"], _start_with: null}), null);

    // Practice mode: Always null, real answer annotated in student answer object
    a = {student_answer: {practice: true, correct: "no"}};
    t.equal(iaalib.markAnswer(a, {correct: ["yes"]}), null);
    t.deepEqual(a, {
        student_answer: {
            correct: "no",
            practice: true,
            practice_correct: false,
        },
    });
    a = {student_answer: {practice: true, correct: "yes"}};
    t.equal(iaalib.markAnswer(a, {correct: ["yes"]}), null);
    t.deepEqual(a, {
        student_answer: {
            correct: "yes",
            practice: true,
            practice_correct: true,
        },
    });

    t.end();
});
