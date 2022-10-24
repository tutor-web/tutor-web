/*jslint nomen: true, plusplus: true, browser:true, todo:true, regexp: true */
/*global require, module, Promise */
var iaalib = new (require('./iaa.js'))();
require('es6-promise').polyfill();
var shuffle = require('knuth-shuffle').knuthShuffle;
var JSONLocalStorage = require('./jsonls');
var getSetting = require('./settings.js').getSetting;

/**
  * Main quiz object
  *  rawLocalStorage: Browser local storage object
  */
module.exports = function Quiz(rawLocalStorage, ajaxApi) {
    "use strict";
    this.lecUri = null;
    this.ajaxApi = ajaxApi;
    this.ls = new JSONLocalStorage(rawLocalStorage);

    // Return last member of array, or null
    function arrayLast(a) {
        return 0 < a.length ? a[a.length - 1] : null;
    }

    // Return current UTC time, in seconds
    function curTime() {
        return Math.floor((new Date()).getTime() / 1000);
    }

    // Turn subscription structure into flat list of URIs
    function lectureUrisFromSubscription(s) {
        if (s.href) {
            return [s.href];
        }
        if (s.children) {
            // Flatten array-of-arrays to an array
            return [].concat.apply([], s.children.map(lectureUrisFromSubscription));
        }
        return [];
    }

    // Return true iff every answerQueue item has been synced
    function isSynced(lecture) {
        var i;
        for (i = 0; i < lecture.answerQueue.length; i++) {
            if (!lecture.answerQueue[i].synced) {
                return false;
            }
        }
        return true;
    }

    // Return number of practice questions student would be allowed to do, 0..Infinity
    function practiceAllowed(curLec) {
        var aq = curLec.answerQueue,
            settings = curLec.settings,
            answers_real = aq.filter(function (a) { return a && (!a.student_answer || !a.student_answer.practice); }).length,
            rv;

        // Work out number of questions we're allowed to do
        rv = getSetting(settings, 'practice_after', 0);
        if (rv === 0) {
            return Infinity; // Always allowed to practice
        }
        rv = Math.floor(answers_real / rv);
        if (!isFinite(rv) || rv === 0) {
            // x/0, i.e. at start and there's a non-zero limit
            // or not enough questions answered yet
            return 0;
        }
        rv = rv * getSetting(settings, 'practice_batch', Infinity);

        // Subtract practice questions already done
        return Math.max(rv - (aq.length - answers_real), 0);
    }

    /** Insert questions into localStorage */
    this.insertQuestions = function (qns) {
        var self = this;
        Object.keys(qns).map(function (qnUri) {
            self.ls.setItem(qnUri, qns[qnUri]);
        });
    };

    /** Return promise to deep array of lectures and their URIs */
    this.getAvailableLectures = function () {
        var self = this;

        return Promise.resolve().then(function () {
            return self._getSubscriptions(false);
        }).then(function (subscriptions) {
            // Get all mentioned lectures, get info about them
            var lectureInfo = {}, lsItems = {};

            // Form a list of all things in localstorage
            self.ls.listItems().map(function (k) {
                lsItems[k] = true;
            });

            // Does this lecture have everything it needs to be offline?
            function isOffline(l) {
                var i;

                for (i = 0; i < l.questions.length; i++) {
                    if (!lsItems[l.questions[i].uri]) {
                        return false;
                    }
                }
                return true;
            }

            return Promise.all(lectureUrisFromSubscription(subscriptions).map(function (uri) {
                return self._getLecture(uri, true).then(function (l) {
                    var currentGrade, a;

                    // If lecture isn't dummy structure, add stats to object
                    // (lecture might be missing if out of localstorge during sync, e.g.)
                    if (l.questions) {
                        a = arrayLast(l.answerQueue) || {};
                        currentGrade = a.hasOwnProperty('grade_after') ? a.grade_after : (a.grade_before || 0);
                        lectureInfo[uri] = {
                            "title": l.title,
                            "grade": currentGrade,
                            "stats": self._gradeSummary(l).stats,
                            "synced": isSynced(l),
                            "offline": isOffline(l),
                        };
                    }
                });
            })).then(function () {
                return {
                    subscriptions: subscriptions,
                    lectures: lectureInfo,
                };
            });
        });
    };

    /** Get a random client ID */
    this._getClientId = function () {
        var client_id = this.ls.getItem('client_id');

        if (!client_id) {
            client_id = Math.random().toString(36).slice(2);
            this.ls.setItem('client_id', client_id);
        }

        return client_id;
    };

    /** Get the subscriptions table */
    this._getSubscriptions = function (missingOkay) {
        var self = this,
            subs = self.ls.getItem('_subscriptions');

        if (self.ls.getItem('_index')) {
            throw new Error("An _index exists from an old version of tutor-web!");
        }

        if (subs) {
            return Promise.resolve(subs);
        }

        if (missingOkay) {
            subs = {children: []};
            self.ls.setItem('_subscriptions', subs);
            return Promise.resolve(subs);
        }

        return Promise.reject(new Error("No subscriptions table"));
    };

    /** Promise to get the given lecture URI, or the current one */
    this._getLecture = function (lecUri, missingOkay) {
        var self = this;

        return Promise.resolve(lecUri || this.lecUri).then(function (lecUri) {
            var lec;

            if (!lecUri) {
                throw new Error("No lecture selected");
            }

            lec = self.ls.getItem(lecUri);
            if (!lec) {
                if (!missingOkay) {
                    if (!self.ls.getItem('_subscriptions')) {
                        throw new Error("Subscriptions not yet downloaded");
                    }
                    throw new Error("Unknown lecture: " + lecUri);
                }
                lec = {};
            }
            if (!lec.answerQueue) {
                lec.answerQueue = [];
            }
            if (!lec.uri) {
                lec.uri = lecUri;
            }
            return lec;
        });
    };

    /** Form a promise-chain that fetches the lecture at the start and sets it at the end */
    this._withLecture = function (lecUri, work, missingOkay) {
        var self = this, lec;

        return self._getLecture(lecUri, missingOkay).then(function (lecture) {
            lec = lecture;  // Store it in our function scope
            return Promise.resolve(lecture);
        }).then(work).then(function (rv) {
            var uri = lec.uri;

            delete lec.uri;
            self.ls.setItem(uri, lec);
            return rv;
        });
    };

    /** Set the current lecture */
    this.setCurrentLecture = function (params) {
        var self = this;

        if (!params || !params.lecUri) {
            throw new Error("lecUri parameter required");
        }
        this.lecUri = params.lecUri;

        return self._getLecture().then(function (lecture) {
            var continuing = false, lastAns = arrayLast(lecture.answerQueue);

            self.lecUri = lecture.uri;
            iaalib.gradeAllocation(lecture.settings, lecture.answerQueue, lecture);

            if (lastAns && !lastAns.time_end) {
                continuing = lastAns.student_answer && lastAns.student_answer.practice ? 'practice' : 'real';
            }

            return {
                a: lastAns,
                continuing: continuing,
                lecUri: lecture.uri,
                lecTitle: lecture.title,
                material_tags: lecture.material_tags,
                practiceAllowed: practiceAllowed(lecture),
            };
        });
    };

    /** True iff a lecture is selected on the current page */
    this.isLectureSelected = function () {
        return !!this.lecUri;
    };

    /** Choose a new question from the current lecture */
    this.getNewQuestion = function (opts) {
        var self = this;

        // Try (attempts) times to call fn, expecting a promise
        function tryRepeatedly(fn, attempts) {
            return fn()['catch'](function (err) {
                if (attempts > 0) {
                    return tryRepeatedly(fn, attempts - 1);
                }
                throw err;
            });
        }

        return self._withLecture(null, function (curLecture) {
            // Repeatedly try assigning a new question, until one works
            return tryRepeatedly(function () {
                var a, lastAns = arrayLast(curLecture.answerQueue);

                if (lastAns && !lastAns.time_end) {
                    // Last question wasn't answered, carry on answering
                    a = lastAns;
                    return self._getQuestionData(a.uri).then(function (qn) {
                        // NB: Not storing allocation in answerqueue again
                        return {qn: qn, a: a};
                    });
                }

                if (opts.practice && !practiceAllowed(curLecture)) {
                    throw new Error('No practice questions left');
                }

                // Fetch a new question
                a = iaalib.newAllocation(curLecture, opts || {});
                a.lec_answered = lastAns && lastAns.lec_answered ? lastAns.lec_answered : 0;
                a.lec_correct = lastAns && lastAns.lec_correct ? lastAns.lec_correct : 0;
                a.practice_answered = lastAns && lastAns.practice_answered ? lastAns.practice_answered : 0;
                a.client_id = self._getClientId();
                return self._getQuestionData(a.uri).then(function (qn) {
                    // Store new allocation in answerQueue
                    curLecture.answerQueue.push(a);
                    return {qn: qn, a: a};
                });
            }, 10).then(function (args) {
                var qn = args.qn, a = args.a;

                a.uri = qn.uri; // The fetch question data might be slightly different

                a.time_start = a.time_start || curTime();
                a.synced = false;
                a.remaining_time = a.allotted_time;
                if (a.allotted_time && a.time_start) {
                    a.remaining_time -= curTime() - a.time_start;
                }

                return {qn: qn, a: a};
            });
        });
    };

    /** Get a new question to review, inject it into the answer queue */
    this.getReviewMaterial = function () {
        var self = this;

        return self.ajaxApi.getJson('/api/stage/request-review?path=' + encodeURIComponent(self.lecUri)).then(function (data) {
            if (!data.uri) {
                return false;
            }
            return self._withLecture(null, function (curLecture) {
                var a = data, lastAns = arrayLast(curLecture.answerQueue);

                a.student_answer = {practice: true};  // NB: We shouldn't be graded directly for this, so use practice mode
                a.lec_answered = lastAns && lastAns.lec_answered ? lastAns.lec_answered : 0;
                a.lec_correct = lastAns && lastAns.lec_correct ? lastAns.lec_correct : 0;
                a.practice_answered = lastAns && lastAns.practice_answered ? lastAns.practice_answered : 0;
                a.client_id = self._getClientId();
                curLecture.answerQueue.push(a);
                return true;
            });
        });
    };

    this.rewriteUgMaterial = function (old_a) {
        var self = this;

        return self.ajaxApi.getJson('/api/stage/ug-rewrite?path=' + encodeURIComponent(self.lecUri) + '&uri=' + encodeURIComponent(old_a.uri) + '&time_end=' + encodeURIComponent(old_a.time_end)).then(function (data) {
            return self._withLecture(null, function (curLecture) {
                var a = data, lastAns = arrayLast(curLecture.answerQueue, {});

                a.lec_answered = lastAns && lastAns.lec_answered ? lastAns.lec_answered : 0;
                a.lec_correct = lastAns && lastAns.lec_correct ? lastAns.lec_correct : 0;
                a.practice_answered = lastAns && lastAns.practice_answered ? lastAns.practice_answered : 0;
                a.client_id = self._getClientId();
                curLecture.answerQueue.push(a);
            }).then(function () {
                // Re-run getNewQuestion to perform normal init
                return self.getNewQuestion({});
            });
        });
    };

    /** Returns a promise with the question data, either from localstorage or HTTP */
    this._getQuestionData = function (uri, cachedOkay) {
        var qn, promise, self = this;

        if (cachedOkay && self._lastFetched && self._lastFetched.uri === uri) {
            // Pull out of in-memory cache
            promise = Promise.resolve(self._lastFetched.question);
        } else {
            qn = self.ls.getItem(uri);
            if (qn) {
                if (qn.error) {
                    // This question didn't render properly, ignore it and get the next
                    throw new Error(qn.error);
                }
                // Fetch out of localStorage
                promise = Promise.resolve(qn);
            } else {
                // Fetch via. HTTP
                // NB: uri isn't really a URI any more, it's the question ID. Bodge.
                promise = self.ajaxApi.getJson('/api/stage/material' +
                                               '?path=' + encodeURIComponent(self.lecUri) +
                                               '&id=' + encodeURIComponent(uri)).then(function (data) {
                    // Dig out the rendered material
                    qn = data.data[uri];

                    if (qn.error) {
                        // This question didn't render properly, ignore it and get the next
                        throw new Error(qn.error);
                    }
                    return qn;
                });
            }
        }

        // Store question for next time around
        // NB: This is here to ensure that answers get the same question data
        // as questions
        return promise.then(function (qn) {
            if (!qn.uri) {
                qn.uri = uri;
            }
            self._lastFetched = { "uri": qn.uri, "question": qn };
            return qn;
        });
    };

    /** User has selected an answer */
    this.setQuestionAnswer = function (formData) {
        var self = this;

        return self._withLecture(null, function (curLecture) {
            var a = arrayLast(curLecture.answerQueue);

            // Fetch question off answer queue, add answer
            a.time_end = curTime();
            Object.keys(formData).map(function (k) { a.student_answer[k] = formData[k]; });
            a.synced = false;

            // Get question data and mark
            return self._getQuestionData(a.uri, true).then(function (qn) {
                var answerData = !qn.hasOwnProperty('correct') ? {}
                               : typeof qn.correct === 'string' ? JSON.parse(window.atob(qn.correct))
                               : qn.correct;

                a.correct = iaalib.markAnswer(a, answerData);

                // Update question with new counts
                curLecture.questions.map(function (qn) {
                    if (a.uri === qn.uri) {
                        qn.chosen += 1;
                        qn.correct += a.correct ? 1 : 0;
                    }
                });

                // Check how long a student should have spent on this question, delay the explanation by the difference
                a.explanation_delay = iaalib.questionStudyTime(curLecture.settings, curLecture.answerQueue);
                if (a.explanation_delay > 0) {
                    a.explanation_delay = Math.max(a.explanation_delay - curTime() + a.time_start, 0);
                }

                // Set appropriate grade
                iaalib.gradeAllocation(curLecture.settings, curLecture.answerQueue, curLecture);
                a.lec_answered = (a.lec_answered || 0) + 1;
                a.lec_correct = (a.lec_correct || 0) + (a.correct ? 1 : 0);
                if (a.hasOwnProperty('student_answer')) {
                    a.practice_answered = (a.practice_answered || 0) + (a.student_answer.practice ? 1 : 0);
                } else {
                    a.practice_answered = (a.practice_answered || 0);
                }

                return {
                    qn: qn,
                    a: a,
                    answerData: answerData,
                    practiceAllowed: practiceAllowed(curLecture),
                    material_tags: curLecture.material_tags,
                };
            });
        });
    };

    this.getQuestionReviewForm = function () {
        var self = this, default_review = [
            {
                name: 'content',
                title: 'What do you think of the question?',
                values: [
                    [-12, "There is a mistake in the problem or the answer"],
                    [0, "I have other feedback"],
                ]
            }
        ];

        return self._withLecture(null, function (curLecture) {
            var a = arrayLast(curLecture.answerQueue);

            return self._getQuestionData(a.uri, true).then(function (qn) {
                return qn.review_questions || default_review;
            });
        });
    };

    /** User has reviewed current question */
    this.setQuestionReview = function (formData) {
        var self = this;

        return self._withLecture(null, function (curLecture) {
            var a = arrayLast(curLecture.answerQueue);

            // Add review to this answer
            a.review = formData;
            a.synced = false;

            return {
                a: a,
                practiceAllowed: practiceAllowed(curLecture),
                material_tags: curLecture.material_tags,
            };
        });
    };

    /** Go through subscriptions, remove any lectures that don't have an owner */
    this.removeUnusedObjects = function () {
        var self = this,
            lsContent = {};

        // Form object of everything in localStorage
        self.ls.listItems().map(function (k) {
            lsContent[k] = 0;
        });

        return Promise.resolve().then(function () {
            return self._getSubscriptions(false);
        }).then(function (subscriptions) {
            lsContent._subscriptions++;
            lsContent.client_id++;

            // Extract lecture URIs
            return Promise.all(lectureUrisFromSubscription(subscriptions).map(function (uri) {
                lsContent[uri]++;

                // Fetch questions also and up their count
                return self._getLecture(uri, true).then(function (l) {
                    (l.questions || []).map(function (q) {
                        lsContent[q.uri]++;
                    });
                });
            }));
        }).then(function () {
            var k, removedItems = [];

            // Remove anything where the refcount is still 0
            for (k in lsContent) {
                if (lsContent.hasOwnProperty(k) && lsContent[k] === 0) {
                    removedItems.push(k);
                    self.ls.removeItem(k);
                }
            }
            return removedItems;
        });
    };

    // 3 queues, before-sync, current, and fresh-from-server
    function _queueMerge(preQ, currentQ, serverQ) {
        var totals = {};

        // Update a running total property
        function runningTotal(a, prop, extra) {
            if (totals.hasOwnProperty(prop)) {
                totals[prop] = totals[prop] + extra;
            } else {
                // First entry, so believe the entry if available
                totals[prop] = a[prop] || extra;
            }
            return totals[prop];
        }

        function syncingLength(aq) {
            var l = aq.length;
            while (l > 0 && !aq[l - 1].time_end) {
                l -= 1;
            }
            return l;
        }

        // Queue: server-returned Q + unanswered questions from preQ
        return [].concat(serverQ, currentQ.splice(syncingLength(preQ))).map(function (a) {
            // Update running totals
            a.lec_answered = runningTotal(a, 'lec_answered', a.time_end ? 1 : 0);
            a.lec_correct  = runningTotal(a, 'lec_correct',  a.correct ? 1 : 0);
            if (a.hasOwnProperty('student_answer')) {
                a.practice_answered = runningTotal(a, 'practice_answered', a.student_answer.practice && a.time_end ? 1 : 0);
            } else {
                a.practice_answered = runningTotal(a, 'practice_answered', 0);
            }

            return a;
        });
    }

    /**
      * Sync the subscription table and everything within.
      * opts can contain:
      * - syncForce: true ==> Sync lectures regardless of whether they seem to need it
      * - skipCleanup: true ==> Skip localstorage garbage collection
      * - lectureAdd: lecture URI to subscribe to
      * - lectureDel: lecture URI to remove subscription for
      * progressFn is a function called when something happens, with arguments
      * - opTotal: Number of operations
      * - opSucceeded: ...out of which this many have finished
      * - message: Message describing current state
     */
    this.syncSubscriptions = function (opts, progressFn) {
        var self = this;

        // Apply promise-returning fn to values in batches of batchSize
        function batchPromise(values, batchSize, fn) {
            var p = Promise.resolve();

            function batchFn(batch) {
                return function () {
                    return Promise.all(batch.map(fn));
                };
            }

            while (values.length > 0) {
                p = p.then(batchFn(values.splice(0, batchSize)));
            }
            return p;
        }

        progressFn(3, 0, "Syncing subscriptions...");
        return Promise.resolve().then(function () {
            if (opts.lectureAdd) {
                return self.ajaxApi.postJson('/api/subscriptions/add?path=' + encodeURIComponent(opts.lectureAdd));
            }
        }).then(function () {
            if (opts.lectureDel) {
                return self.ajaxApi.postJson('/api/subscriptions/remove?path=' + encodeURIComponent(opts.lectureDel));
            }
        }).then(function () {
            return self.ajaxApi.postJson('/api/subscriptions/list', {});
        }).then(function (subscriptions) {
            self.ls.setItem('_subscriptions', subscriptions);
            if (!opts.skipCleanup && opts.lectureDel) {
                // Removing something, so tidy up now in case quota is full
                return self.removeUnusedObjects().then(function () {
                    return subscriptions;
                });
            }
            return subscriptions;
        }).then(function (subscriptions) {
            var lectureUris = lectureUrisFromSubscription(subscriptions),
                opSucceeded = 0,
                opTotal = lectureUris.length + 1;

            return batchPromise(lectureUris, 6, function (uri) {
                return self.syncLecture(uri, {
                    ifMissing: 'fetch',
                    syncForce: opts.syncForce,
                    skipQuestions: false,
                    skipCleanup: true,
                }, function (lecSucceeded, lecTotal, message) {
                    if (lecSucceeded === lecTotal) {
                        opSucceeded = opSucceeded + 1;
                    }
                    progressFn(opTotal, opSucceeded, uri + ": " + message);
                });
            }).then(function () {
                progressFn(opTotal - 1, opTotal, "Tidying up...");
                return opts.skipCleanup ? null : self.removeUnusedObjects();
            }).then(function () {
                progressFn(opTotal, opTotal, "Done");
            });
        });
    };

    /** Return promise that lecture is synced */
    this.syncLecture = function (lecUri, opts, progressFn) {
        var self = this;

        if (!progressFn) {
            progressFn = function () { return; };
        }
        if (!opts || opts === true) {
            opts = { syncForce: !!opts };
        }

        return self._getLecture(lecUri, opts.ifMissing === 'fetch').then(function (preSyncLecture) {
            if (!opts.syncForce && preSyncLecture.hasOwnProperty('questions') && isSynced(preSyncLecture)) {
                // Nothing to do
                return;
            }
            progressFn(0, 3, "Fetching lecture...");

            preSyncLecture.current_time = curTime();
            return self.ajaxApi.postJson(preSyncLecture.uri, preSyncLecture, { timeout: 60 * 1000 }).then(function (newLecture) {
                // Check it's for the same user
                if (preSyncLecture.user && preSyncLecture.user !== newLecture.user) {
                    throw new Error("tutorweb::error::You are trying to download a lecture as '" +
                        newLecture.user + "', but you were logged in previously as '" +
                        preSyncLecture.user + "'. Return to the menu and log out first.");
                }

                // Write out replacement lecture
                return self._withLecture(lecUri, function (curLecture) {
                    // Copy contents of newLec over curLec, since otherwise _withLecture won't update
                    Object.keys(newLecture).map(function (k) {
                        curLecture[k] = k === 'answerQueue'
                            ? _queueMerge(preSyncLecture.answerQueue, curLecture.answerQueue, newLecture.answerQueue)
                            : newLecture[k];
                    });
                    return newLecture;
                }, opts.ifMissing === 'fetch');
            }).then(function (curLecture) {
                // Make sure material_uri is populated
                if (!curLecture.material_uri) {
                    curLecture.material_uri = '/api/stage/material?path=' + encodeURIComponent(curLecture.path);
                }

                // Check if either we have no question bank yet, or we have missing questions
                var missingQns = opts.forceQuestions || curLecture.questions.length === 0 || curLecture.questions.find(function (q) {
                    return (self.ls.getItem(q.uri) === null);
                });

                if (missingQns) {
                    progressFn(1, 3, "Fetching questions... ");
                    return ajaxApi.getJson(curLecture.material_uri, {timeout: 60 * 1000}).then(function (data) {
                        return self._withLecture(lecUri, function (curLecture) {
                            curLecture.questions = data.stats;
                            Object.keys(data.data).map(function (qnId) {
                                self.ls.setItem(qnId, data.data[qnId]);
                            });
                        });
                    });
                }
            }).then(function () {
                progressFn(2, 3, "Tidying up...");
                return opts.skipCleanup ? null : self.removeUnusedObjects();
            }).then(function () {
                progressFn(3, 3, "Done");
            });
        });
    };

    /** Return a promise call that gets the slides */
    this.fetchSlides = function (lecUri) {
        var self = this;

        return self._getLecture(lecUri).then(function (curLecture) {
            if (!curLecture.slide_uri) {
                throw "tutorweb::error::No slides available!";
            }
            return self.ajaxApi.getHtml(curLecture.slide_uri);
        });
    };

    /** Turn answerQueue into select_list tree for review */
    this.fetchReview = function (lecUri) {
        var self = this;

        return self._getLecture(lecUri).then(function (curLecture) {
            return {material: curLecture.answerQueue.map(function (a) {
                return {
                    uri: a.uri,
                    text: a.student_answer.text,  // TODO: rst it, somewhere
                    time_end: a.time_end,
                    children: a.ug_reviews.map(function (r) {
                        return r;
                    }),
                    correct: a.hasOwnProperty('correct') ? a.correct : undefined,
                    mark: a.mark || 0,
                };
            })};
        });
    };

    /** Output a selection of summary strings on the given / current lecture */
    this._gradeSummary = function (lecture) {
        var i, a, currentGrade,
            out = {},
            gradeVisible = getSetting(lecture.settings, 'grade_nmin', 8) - (lecture.answerQueue || []).length;

        if (!lecture) {
            throw new Error("No lecture Given");
        }
        a = arrayLast(lecture.answerQueue) || {};

        if (a.student_answer && a.student_answer.practice) {
            out.practice = "Practice mode";
            if (a.hasOwnProperty('practice_answered')) {
                out.practiceStats = "Answered " + a.practice_answered + " practice questions.";
            }
        }

        if (a.hasOwnProperty('lec_answered') && a.hasOwnProperty('lec_correct')) {
            out.stats = "Answered " + (a.lec_answered - (a.practice_answered || 0)) + " questions, "
                + (a.lec_correct) + " correctly.";
        }

        if (a.hasOwnProperty('grade_after') || a.hasOwnProperty('grade_before')) {
            currentGrade = a.hasOwnProperty('grade_after') ? a.grade_after : a.grade_before;

            if (gradeVisible > 0) {
                out.grade = "Answer " + gradeVisible + " more questions to see your grade";
            } else {
                out.grade = "Your grade: " + currentGrade;
            }
        }

        if (currentGrade >= 9.750) {
            out.encouragement = "You have aced this lecture!";
        } else if (a.grade_next_right && gradeVisible <= 0  && (a.grade_next_right > currentGrade)) {
            out.encouragement = "If you get the next question right: " + a.grade_next_right;
        } else if (lecture.settings.award_stage_aced && lecture.settings.award_tutorial_aced) {
            out.encouragement = "Win " + Math.round(lecture.settings.award_stage_aced / 1000) + " SMLY if you ace this stage, bonus "
                                       + Math.round(lecture.settings.award_tutorial_aced / 1000) + " SMLY for acing whole tutorial";
        }

        out.lastEight = [];
        for (i = lecture.answerQueue.length - 1; i >= 0 && out.lastEight.length < 8; i--) {
            if (lecture.answerQueue[i].time_end && !lecture.answerQueue[i].student_answer.practice) {
                out.lastEight.push(lecture.answerQueue[i]);
            }
        }

        return out;
    };

    /** Promise-wrapped version to get lecture first */
    this.lectureGradeSummary = function (lecUri) {
        var self = this;

        return self._getLecture(lecUri).then(function (curLecture) {
            return self._gradeSummary(curLecture);
        });
    };

    /** Return a promise, returning the current account balance **/
    this.updateAward = function (walletId, captchaResponse) {
        var self = this;

        if (walletId && walletId !== '$$DONATE:EIAS' && !captchaResponse) {
            // No reCAPTCHA response, so just do a view
            walletId = null;
        }

        return self.ajaxApi.postJson(
            '/api/coin/award',
            { "walletId": walletId, "captchaResponse": captchaResponse }
        );
    };

    /** Return promise, returning (updated) student details */
    this.updateUserDetails = function (userDetails) {
        var self = this;

        return self.ajaxApi.postJson('/api/student/details', userDetails).then(function (details) {
            if (!self.lecUri) {
                // There isn't a set lecture to check yet, so continue
                return details;
            }
            return self._getLecture(self.lecUri, true).then(function (lecture) {
                if (lecture.user && lecture.user !== details.username) {
                    throw new Error("You were logged in before as " + lecture.user + " and need to log out first");
                }
                return details;
            });
        });
    };
};
