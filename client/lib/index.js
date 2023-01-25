"use strict";
/*jslint nomen: true, plusplus: true, browser:true, todo: true */
/*global require */
var jQuery = require('jquery');
var Quiz = require('./quizlib.js');
var View = require('./view.js');
var AjaxApi = require('./ajaxapi.js');
var UserMenu = require('./usermenu.js');
var parse_qs = require('../lib/parse_qs.js').parse_qs;
var parse_url = require('../lib/parse_qs.js').parse_url;
var isQuotaExceededError = require('./ls_utils.js').isQuotaExceededError;
var h = require('hyperscript');
var select_list = require('lib/select_list.js').select_list;
var render_progress = require('lib/progress.js').render_progress;

function StartView() {
    /** Generate expanding list for tutorials / lectures */
    this.renderChooseLecture = function (subscriptions, update_url) {
        function grade_for(data) {
            var i, out;

            if (subscriptions.lectures[data.href]) {
                return subscriptions.lectures[data.href].grade;
            }

            if (!data.children || !data.children.length) {
                return 0;
            }

            // Grade should be mean of everything within
            out = 0;
            for (i = 0; i < data.children.length; i++) {
                out += grade_for(data.children[i]);
            }
            return Math.round(out / data.children.length * 100) / 100;
        }

        this.jqQuiz.empty().append(h('div', [
            h('h2', 'Your lectures'),
            select_list(subscriptions.subscriptions.children, function (data) {
                var link_el = null,
                    grade = grade_for(data),
                    grade_class = grade > 9.5 ? 'aced'
                                : grade > 7.0 ? 'high'
                                : grade > 3.0 ? 'medium'
                                : grade > 1.0 ? 'low'
                                    : 'base',
                    grade_title = (subscriptions.lectures[data.href] || { stats: "" }).stats;

                function admin_link() {
                    if (!data.can_admin) {
                        return null;
                    }

                    return h('a.link.pdf', {
                        href: '/admin?path=' + data.path,
                        title: 'Administer tutorial',
                    }, h('img', {src: '/images/cog.png'}));
                }

                if (data.supporting_material_href) {
                    link_el = h('a.link.pdf', {
                        href: data.supporting_material_href,
                        title: 'Download notes',
                        target: '_blank',
                    }, [
                        h('img', {src: '/images/page_white_put.png'}),
                    ]);
                }
                return h('a', {
                    href: data.href ? '/stage?path=' + encodeURIComponent(data.href) : '#',
                }, [
                    data.title,
                    h('div.extras', [
                        link_el,
                        admin_link(),
                        h('abbr.grade.' + grade_class, { title: grade_title }, grade),
                    ]),
                ]);
            }, function (selected_items) {
                if (!update_url || selected_items.length === 0) {
                    return;
                }

                var sel_path = selected_items[selected_items.length - 1].path;

                if (window.history && window.history.replaceState) {
                    window.history.replaceState({}, "", "?path=" + encodeURIComponent(sel_path));
                }
            }),
        ]));
    };
}
StartView.prototype = new View(jQuery);

(function (window, $) {
    var quiz, twView, twMenu,
        unsyncedLectures = [];

    // Do nothing if not on the right page
    if (!window) { return; }

    // Wire up quiz object
    twView = new StartView($);

    // Start state machine
    twView.locale.logout = 'Clear data and logout';

    // Create Quiz model
    twView.states.initial = function () {
        quiz = new Quiz(localStorage, new AjaxApi($.ajax));
        twView.quiz = quiz;
        twMenu = new UserMenu($('#tw-usermenu'), quiz);
        twMenu.noop = 1; // NB: Keep JSLint quiet
        twView.updateActions(['logout', '']);
        return 'subscription-sync';
    };

    twView.states['subscription-sync'] = twView.states['subscription-sync-force'] = function (curState) {
        return quiz.syncSubscriptions({
            lectureAdd: twView.curUrl.path ? 'nearest-tut:' + twView.curUrl.path : null,
            syncForce: curState === 'subscription-sync-force',
        }, function (opTotal, opSucceeded, message) {
            render_progress(twView.jqQuiz, opSucceeded, opTotal, message);
        }).then(function () {
            return 'lecturemenu';
        })['catch'](function (err) {
            if (isQuotaExceededError(err)) {
                return 'menu-cleanstorage';
            }
            if (err.message.indexOf('tutorweb::unauth::') === 0) {
                return 'go-login';
            }
            if (err.message.indexOf('tutorweb::notacceptedterms::') === 0) {
                return 'terms-display';
            }
            if (err.message.indexOf('tutorweb::error::MissingDataException') === 0) {
                // Set current path temporarily to the failing lecture and request data.
                twView.curUrl.path = parse_url(err.url).path;
                return 'data-display';
            }
            if (err.message.indexOf('tutorweb::neterror::') === 0) {
                // i.e. we're probably offline
                return 'lecturemenu';
                //TODO: But what if we didn't manage to get the subscriptions table? Empty isn't good enough.
            }
            console.error(err);
            if (err.message.indexOf('tutorweb::') !== -1) {
                var parts = err.message.split(/\:\:/).splice(1);
                twView.showAlert(parts[0], 'Syncing failed: ' + parts[1], parts[2]);
            } else {
                twView.showAlert('error', 'Syncing failed: ' + err.message);
            }
            // Stop and give user a chance to reconsider
            twView.updateActions(['reload', 'lecturemenu']);
        });
    };

    twView.states['menu-cleanstorage'] = function () {
        return quiz.getAvailableLectures().then(function (subscriptions) {
            twView.renderChooseLecture(subscriptions, false);
            twView.showAlert('warning', 'You have run out of storage space. Please choose items to remove.');
        });
    };

    twView.states.lecturemenu = function () {
        return quiz.getAvailableLectures().then(function (subscriptions) {
            function markSelected(parent, selected_path) {
                if (!selected_path) {
                    return;
                }
                parent.children.forEach(function (item) {
                    if (selected_path.indexOf(item.path) === 0) {  // i.e. item is parent of selected_path
                        item.init_select = true;
                        markSelected(item, selected_path);
                    } else {
                        item.init_select = false;
                    }
                });
            }

            if (Object.keys(subscriptions.lectures).length === 0) {
                twView.jqQuiz.empty();
                return 'subscription-menu';
            }
            markSelected(subscriptions.subscriptions, (twView.curUrl.path || "").replace("/api/stage?path=", "") || (subscriptions.subscriptions.children[0] || {}).path);
            twView.renderChooseLecture(subscriptions, true);

            // Get all lecture titles from unsynced lectures
            unsyncedLectures = Object.keys(subscriptions.lectures)
                .filter(function (k) { return !subscriptions.lectures[k].synced; })
                .map(function (k) { return subscriptions.lectures[k].title; });
        });
    };

    twView.states.logout = function () {
        if (unsyncedLectures.length === 0 || window.confirm("Your answers to " + unsyncedLectures[0] + " haven't been sent to the Tutor-Web server.\nIf you click okay some answers will be lost")) {
            twView.quiz.clearStorage();
            window.location.href = '/auth/logout';
        }
    };

    twView.states['go-slides'] = function () {
        window.location.href = 'slide.html' + twView.selectListHref();
    };

    twView.states['go-drill'] = function () {
        window.location.href = 'quiz.html' + twView.selectListHref();
    };

    twView.stateMachine();
}(window, jQuery));
