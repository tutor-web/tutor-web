/*jslint nomen: true, plusplus: true, browser:true, regexp: true, unparam: true, todo: true */
/*global require, Promise */
"use strict";
var jQuery = require('jquery');
require('es6-promise').polyfill();
var Quiz = require('lib/quizlib.js');
var View = require('lib/view.js');
var AjaxApi = require('lib/ajaxapi.js');
var Timer = require('lib/timer.js');
var UserMenu = require('lib/usermenu.js');
var render_progress = require('lib/progress.js').render_progress;
var formson = require('formson');
var h = require('hyperscript');

/**
  * View class to translate data into DOM structures
  *    $: jQuery
  */
function QuizView($) {
    this.jqGrade = $('#tw-grade');
    this.jqAnswers = $('#tw-answers');

    // Generate a jQueried DOM element
    function el(name) {
        return $(document.createElement(name));
    }

    /** Render next question */
    this.renderNewQuestion = function (qn, a, actionsOnChange) {
        var self = this, jqForm = el('form');

        jqForm.append(qn.content);

        jqForm.on('change', function () {
            self.updateActions(actionsOnChange);
        });
        jqForm.on('keypress', function () {
            // Typing in a textarea should also change actions
            self.updateActions(actionsOnChange);
        });

        // Remove any reveal-on-answers with a placeholder
        Array.prototype.map.call(jqForm[0].querySelectorAll('.reveal-on-answer'), function (el) {
            var placeholder_el = h('div.reveal-on-answer-placeholder');
            $(placeholder_el).data('orig', el.parentNode.replaceChild(placeholder_el, el));
        });

        self.jqQuiz.empty().append([
            jqForm,
        ]);

        if (a.student_answer) {
            formson.update_form(jqForm[0], a.student_answer);
        }

        return self.renderMath();
    };

    /** Annotate with correct / incorrect selections */
    this.renderAnswer = function (a, answerData) {
        var self = this;

        // Disable any input controls
        self.jqQuiz.find('input,textarea,select').attr('disabled', 'disabled');

        // Replace placeholders with the real content
        Array.prototype.map.call(self.jqQuiz[0].querySelectorAll('div.reveal-on-answer-placeholder'), function (el) {
            el.parentNode.replaceChild($(el).data('orig'), el);
        });

        self.jqQuiz.find('#answer_' + a.selected_answer).addClass('selected');
        // Mark all answers as correct / incorrect
        Object.keys(answerData).map(function (k) {
            if (Array.isArray(answerData[k])) {
                // Find any form elements with key/value and mark as correct
                self.jqQuiz.find('*[name=' + k + ']').each(function () {
                    var correct = answerData[k].indexOf($(this).val()) > -1;
                    this.classList.toggle('correct', correct);
                    this.classList.toggle('incorrect', !correct);
                });
            }
        });

        if (a.hasOwnProperty('correct')) {
            self.jqQuiz.children('form').toggleClass('undecided', a.correct === null);
            self.jqQuiz.children('form').toggleClass('correct', a.correct === true);
            self.jqQuiz.children('form').toggleClass('incorrect', a.correct === false);
        }

        self.renderMath();
    };

    /** Add on form to speak your branes */
    this.renderReviewForm = function (form_desc) {
        var review_el;

        function show_next_fieldset(start_el) {
            var i, next_fieldset = false, elements = start_el.form.elements;

            for (i = 0; i < elements.length; i++) {
                // If we've reached start_el, start looking for a fieldset
                next_fieldset = next_fieldset || elements[i] === start_el;

                if (next_fieldset && elements[i].tagName === 'FIELDSET') {
                    elements[i].style.display = '';
                    return;
                }
            }
        }

        review_el = h('form', form_desc.map(function (r) {
            return h('fieldset', {'style': {display: 'none'}}, [
                h('legend', r.title),
                h('ol.fixed', r.values.map(function (v) {
                    return h('li', h('label', [
                        h('input', {type: 'radio', name: r.name, value: v[0]}),
                        h('span', v[1]),
                    ]));
                })),
            ]);
        }).concat(h('fieldset', {'style': {display: 'none'}}, [
            h('legend', 'Any other comments?'),
            h('textarea', {name: 'comments'}),
        ])));

        // Un-hide first fieldset, on each change show next one
        show_next_fieldset(review_el.elements[0]);
        review_el.addEventListener('change', function (e) {
            show_next_fieldset(e.target);
        });

        this.jqQuiz.append(review_el);
    };

    this.renderGradeSummary = function (summary) {
        var self = this,
            jqGrade = self.jqGrade,
            jqStats = this.jqAnswers.find('.current'),
            jqList = this.jqAnswers.children('ol.previous');

        jqGrade.text(summary.practice || summary.grade || '');
        if (summary.encouragement) {
            jqGrade.text(jqGrade.text() + ' ~ ' + summary.encouragement);
        }
        jqStats.text(summary.practiceStats || summary.stats || '');
        jqList.empty().append((summary.lastEight || []).map(function (a) {
            var t = new Date(0),
                title = '';
            t.setUTCSeconds(a.time_end);

            if (a.selected_answer) {
                title += 'You chose ' + String.fromCharCode(97 + a.selected_answer) + '\n';
            }
            title += 'Answered ' + t.toLocaleDateString() + ' ' + t.toLocaleTimeString();

            if (a.correct === true) {
                return $('<li/>').attr('title', title)
                                 .addClass('correct')
                                 .append($('<span/>').text("✔"));
            }
            if (a.correct === false) {
                return $('<li/>').attr('title', title)
                                 .addClass('incorrect')
                                 .append($('<span/>').text("✗"));
            }
            return $('<li/>').attr('title', title).append($('<span/>').text("-"));
        }));
    };

    this.renderStart = function (args) {
        var self = this;
        $("#tw-title").text(args.lecTitle);
        self.jqQuiz.empty().append($("<p/>").text(
            args.continuing ? "Click 'Continue question' to carry on" : "Click 'New question' to start"
        ));
    };

}
QuizView.prototype = new View(jQuery);

(function (window, $) {
    var quiz, twView, twTimer, twMenu;
    // Do nothing if not on the right page
    if (!window) { return; }

    /** Generate of appropriate actions after answering a question */
    function postQuestionActions(args) {
        var out = ['gohome'];

        if (args.material_tags.indexOf("type.template") > -1) {
            // Material-writing lectures have entirely different flow
            return ['ug-review', 'ug-review-material', 'ug-write'];
        }

        if (args.qn) {
            out.push('qn-startreview');
        }
        if (args.material_tags.indexOf("type.example") > -1) {
            out.push('load-example');
        } else {
            if (args.practiceAllowed > 0) {
                out.push('quiz-practice');
            }
            out.push('quiz-real');
        }
        return out;
    }

    // Wire up Quiz View
    twView = new QuizView($);
    twTimer = new Timer($('#tw-timer span'));
    twView.twTimer = twTimer;

    // Create Quiz model
    twView.states.initial = function () {
        quiz = new Quiz(localStorage, new AjaxApi($.ajax));
        twView.quiz = quiz;
        twMenu = new UserMenu($('#tw-usermenu'), quiz);
        return 'set-lecture';
    };

    // Load the lecture referenced in URL, if successful hit the button to get first question.
    twView.states['set-lecture'] = function () {
        twView.updateActions([]);
        return quiz.setCurrentLecture({lecUri: twView.curUrl.path}).then(function (args) {
            twView.renderStart(args);
            quiz.lectureGradeSummary(twView.curUrl.lecUri).then(twView.renderGradeSummary.bind(twView));

            if (args.continuing === 'practice') {
                return 'quiz-practice';
            }
            if (args.continuing === 'real') {
                return 'quiz-real';
            }
            if (args.material_tags.indexOf("type.template") > -1) {
                return 'ug-review';
            }
            twView.updateActions(postQuestionActions(args));
        })['catch'](function (err) {
            // Try syncing, see if that fixes our problems (e.g. subscriptions not here or out-of-date)
            twView.updateActions([]);
            return quiz.syncSubscriptions({}, function (opTotal, opSucceeded, message) {
                render_progress(twView.jqQuiz, opSucceeded, opTotal, message);
            }).then(function () {
                return quiz.setCurrentLecture({lecUri: twView.curUrl.path}).then(function () {
                    // It's there now, so can try again
                    return 'set-lecture';
                }).catch(function (err) {
                    // Still not subscribed, ask user if they'd like to
                    if (err.message.indexOf("Unknown lecture: ") === 0) {
                        twView.jqQuiz.empty();
                        twView.showAlert('info', 'You are not subscribed yet, you need to subscribe before taking drills. Do you wish to?');
                        twView.selected_item = 'nearest-tut:' + twView.curUrl.path;
                        twView.return_state = 'set-lecture';
                        twView.updateActions(['subscription-add']);
                        return;
                    }
                    // Something else is wrong, throw it upwards
                    throw err;
                });
            });
        })['catch'](function (err) {
            if (err.message.indexOf('tutorweb::unauth::') === 0) {
                return 'go-login';
            }
            throw err;
        });
    };

    twView.states['load-example'] = twView.states['quiz-real'] = twView.states['quiz-practice'] = function (curState, updateState) {
        twView.updateActions([]);
        return quiz.getNewQuestion({
            practice: curState === 'quiz-practice'
        }).then(function (args) {
            args.actions = ['qn-skip', 'qn-submit'];

            quiz.lectureGradeSummary(twView.curUrl.lecUri).then(twView.renderGradeSummary.bind(twView));
            return twView.renderNewQuestion(args.qn, args.a, args.actions).then(function () {
                return args;
            });
        }).then(function (args) {
            var skipAction = args.actions[0];

            if (args.qn.tags.indexOf("type.example") > -1) {
                // If it's an example, don't wait for an answer
                return 'qn-skip';
            }

            twView.updateActions([skipAction]);
            // Once MathJax is finished, start the timer
            if (args.a.remaining_time) {
                twTimer.start(function () {
                    twTimer.text("Out of time!");
                    updateState(skipAction);
                }, args.a.remaining_time);
            } else {
                twTimer.reset();
            }
        })['catch'](function (err) {
            if (err.message.indexOf('tutorweb::noquestions::') === 0) {
                // If there aren't any questions, try again to fetch them, if this fails we error.
                return twView.quiz.syncLecture(twView.quiz.lecUri, {
                    ifMissing: 'fetch',
                    syncForce: true,
                    skipQuestions: false,
                    forceQuestions: true,
                    skipCleanup: false,
                }, function (opTotal, opSucceeded, message) {
                    render_progress(twView.jqQuiz, opSucceeded, opTotal, message);
                }.bind(this)).then(function () {
                    return 'set-lecture';
                });
            }
            throw err;
        });
    };

    twView.states['qn-skip'] = twView.states['qn-submit'] = function (curState) {
        // Disable all controls and mark answer
        twView.updateActions([]);
        return quiz.setQuestionAnswer(curState === 'qn-skip' ? {} : formson.form_to_object(twView.jqQuiz.children('form')[0])).then(function (args) {
            twView.renderAnswer(args.a, args.answerData, args.qn);
            quiz.lectureGradeSummary(twView.curUrl.lecUri).then(twView.renderGradeSummary.bind(twView));
            twMenu.syncAttempt();

            if (args.qn.tags.indexOf("review.mandatory") > -1) {
                return 'qn-startreview';
            }

            twView.updateActions([]);
            if (args.a.explanation_delay) {
                twTimer.start(function () {
                    twTimer.reset();
                    twView.updateActions(postQuestionActions(args));
                }, args.a.explanation_delay);
            } else {
                twView.updateActions(postQuestionActions(args));
            }
        });
    };

    twView.states['qn-startreview'] = function (curState) {
        twView.updateActions([]);

        return quiz.getQuestionReviewForm().then(function (form_desc) {
            twView.renderReviewForm(form_desc);
            twView.updateActions([null, 'qn-submitreview']);
        });
    };

    twView.states['qn-submitreview'] = function (curState) {
        return quiz.setQuestionReview(formson.form_to_object(twView.jqQuiz.children('form')[1])).then(function (args) {
            twMenu.syncAttempt();

            twView.updateActions(postQuestionActions(args).filter(function (s) { return s !== 'qn-startreview'; }));
        });
    };

    twView.stateMachine(function updateState(curState, fallback) {
        twTimer.stop();
        fallback(curState);
    });
}(window, jQuery));
