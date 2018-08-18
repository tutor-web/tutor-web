"use strict";
/*jslint nomen: true, plusplus: true*/
var test = require('tape');

var Promise = require('es6-promise').Promise;
var Timer = require('../lib/timer.js');

function FakeJqEl() {
    this.events = [];
    this.visible = false;

    this.hide = function () {
        if (this.visible) {
            this.events.push('hide');
            this.visible = false;
        }
    };

    this.show = function () {
        if (!this.visible) {
            this.events.push('show');
            this.visible = true;
        }
    };

    this.text = function (t) {
        this.events.push('text: ' + t);
    };
}

function revRange(max) {
    var i, out = [];

    for (i = 0; i < max; i++) {
        out.push(max - i);
    }
    return out;
}

test('Countdown', function (t) {
    var jqTimer = new FakeJqEl();

    global.window = {
        clearTimeout: clearTimeout,
        setTimeout: function (fn, time) {
            setTimeout(fn, time / 1000);
        }
    };

    Promise.resolve().then(function () {
        var twTimer = new Timer(jqTimer);

        return new Promise(function (resolve) {
            twTimer.start(function () {
                twTimer.text("First done!");
                resolve(twTimer);
            }, 123);
        });

    }).then(function () {
        t.deepEqual(jqTimer.events, [].concat([
            'show',
            'text: 2 mins 3 secs',
            'text: 2 mins 2 secs',
            'text: 2 mins 1 sec',
            'text: 2 mins 0 secs',
        ], revRange(58).map(function (i) { return "text: 1 min " + (i + 1) + " secs"; }), [
            'text: 1 min 1 sec',
            'text: 1 min 0 secs',
        ], revRange(58).map(function (i) { return "text: " + (i + 1) + " secs"; }), [
            'text: 1 sec',
            'text: 0 secs',
            'text: First done!',
        ]));

    // Stop it and tidy up
    }).then(function () {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});

test('FloatInput', function (t) {
    var jqTimer = new FakeJqEl();

    global.window = {
        clearTimeout: clearTimeout,
        setTimeout: function (fn, time) {
            setTimeout(fn, time / 1000);
        }
    };

    Promise.resolve().then(function () {
        var twTimer = new Timer(jqTimer);

        return new Promise(function (resolve) {
            twTimer.start(function () {
                twTimer.text("First done!");
                resolve(twTimer);
            }, 5.8);
        });

    }).then(function () {
        t.deepEqual(jqTimer.events, [].concat([
            'show',
            'text: 6 secs',
            'text: 5 secs',
            'text: 4 secs',
            'text: 3 secs',
            'text: 2 secs',
            'text: 1 sec',
            'text: 0 secs',
            'text: First done!',
        ]));

    // Stop it and tidy up
    }).then(function () {
        t.end();
    }).catch(function (err) {
        console.log(err.stack);
        t.fail(err);
        t.end();
    });
});
