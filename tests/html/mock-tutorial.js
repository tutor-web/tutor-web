/*jslint nomen: true, plusplus: true, browser:true*/
/*global */
var jQuery = require('jquery');
var Quiz = require('../../lib/quizlib.js');

(function (window, $) {
    "use strict";
    function handleError(message) {
        window.alert("error: " + message);
    }

    var quiz = new Quiz(window.localStorage, handleError);
    $('#tw-proceed').bind('click', function (event) {
        var questions = {
            "testfixture:question-allocation/a" : {
                "text": '<div>The symbol for the set of all irrational numbers is... (a)</div>',
                "choices": [
                    '<div>$\\mathbb{R} \\backslash \\mathbb{Q}$ (me)</div>',
                    '<div>$\\mathbb{Q} \\backslash \\mathbb{R}$</div>',
                    '<div>$\\mathbb{N} \\cap \\mathbb{Q}$</div>' ],
                "shuffle": [0, 1, 2],
                "answer": window.btoa(JSON.stringify({
                    "explanation": "<div>\nThe symbol for the set of all irrational numbers (a)\n</div>",
                    "correct": [0]
                }))
            },
            "testfixture:question-allocation/b" : {
                "text": '<div>The symbol for the set of all irrational numbers is... (b)</div>',
                "choices": [
                    '<div>$\\mathbb{R} \\backslash \\mathbb{Q}$ (me)</div>',
                    '<div>$\\mathbb{Q} \\backslash \\mathbb{R}$</div>',
                    '<div>$\\mathbb{N} \\cap \\mathbb{Q}$ (me)</div>' ],
                "shuffle": [0, 1],
                "answer": window.btoa(JSON.stringify({
                    "explanation": "<div>\nThe symbol for the set of all irrational numbers (b)\n</div>",
                    "correct": [0, 2]
                }))
            },
            "testfixture:question-allocation/c" : {
                "text": '<div>The symbol for the set of all irrational numbers is... (c)</div>',
                "choices": [
                    '<div>$\\mathbb{R} \\backslash \\mathbb{Q}$</div>',
                    '<div>$\\mathbb{Q} \\backslash \\mathbb{R}$</div>',
                    '<div>$\\mathbb{N} \\cap \\mathbb{Q}$</div>' ],
                "shuffle": [0, 1, 2],
                "answer": window.btoa(JSON.stringify({
                    "explanation": "<div>\nThe symbol for the set of all irrational numbers (c)\n</div>",
                    "correct": [0]
                }))
            }
        };

        quiz.insertTutorial(
            'testfixture:' + document.getElementById('mock-tutorial-uri').value,
            document.getElementById('mock-tutorial-title').value,
            [
                {
                    "uri": 'testfixture:' + document.getElementById('mock-lecture-uri').value,
                    "sync_uri": null,
                    "title": document.getElementById('mock-lecture-title').value,
                    "slide_uri": "http://localhost:8000/mock-slides.html",
                    "questions": Object.keys(questions).map(function (e) {
                        return {"uri": e, "chosen": 45, "correct": 20};
                    }),
                    "answerQueue": [],
                    "settings": {
                        "hist_sel": document.getElementById('mock-histsel').value
                    }
                }
            ]
        );
        quiz.insertQuestions(questions, function () {
            window.alert("Finished!");
        });
    });
}(window, jQuery));
