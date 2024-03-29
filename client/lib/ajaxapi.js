/*jslint nomen: true, plusplus: true, browser:true, todo:true */
/*global module, require, window, Promise, Set */
require('es6-promise').polyfill();
var LZString = require('lz-string');

/**
  * Promise-based AJAX API wrapping jQuery
  * Based on: https://gist.github.com/tobiashm/0a987db2f9ec8e5cdbb3
  */
module.exports = function AjaxApi(jqAjax) {
    "use strict";

    /** Fetch any URL, expect HTML back */
    this.getHtml = function (url, extras) {
        return this.ajax({
            type: 'GET',
            datatype: 'html',
            url: url
        }, extras);
    };

    /** Fetch any URL, expect JSON back */
    this.getJson = function (url, extras) {
        return this.ajax({
            type: 'GET',
            headers: { accept: "application/json" },
            url: url
        }, extras).then(function (data) {
            if (typeof data !== 'object') {
                throw new Error('tutorweb::error::Got a ' + typeof data + ', not object whilst fetching ' + url);
            }
            return data;
        });
    };

    /** Post data, encoded as JSON, to url */
    this.postJson = function (url, data, extras) {
        return this.ajax({
            data: JSON.stringify(data),
            contentType: 'application/json',
            type: 'POST',
            headers: { accept: "application/json" },
            url: url
        }, extras).then(function (data) {
            if (typeof data !== 'object') {
                throw new Error('tutorweb::error::Got a ' + typeof data + ', not object whilst fetching ' + url);
            }
            return data;
        });
    };

    /** Fetch URL, storing in cache if available */
    this.getCachedJson = function (url, opts) {
        var ac, fetch_opts = {};

        if (!window.caches) {
            return this.getJson(url, opts);
        }

        return window.caches.open('ajaxapi-v1').then(function (cache) {
            return cache.match(url).then(function (response) {
                if (response) {
                    // Already in cache, return that
                    return response.text().then(function (text) {
                        return JSON.parse(LZString.decompressFromUTF16(text));
                    });
                }

                if (opts.timeout > 0 && window.AbortController) {
                    ac = new window.AbortController();
                    setTimeout(ac.abort.bind(ac), opts.timeout);
                    fetch_opts.signal = ac.signal;
                }

                return window.fetch(url, fetch_opts).then(function (response) {
                    if (!response.ok) {
                        throw new Error("tutorweb::error::Server error whilst fetching " + url);
                    }
                    return response.clone().text().then(function (text) {
                        // NB: We're compressing it to obscure the contents, rather than it being a useful operation
                        var compressed = LZString.compressToUTF16(text);
                        return cache.put(url, new window.Response(compressed, {
                            status: 200,
                            statusText: 'OK',
                            headers: {
                                'Content-Type': 'application/binary',
                                'Content-Length': compressed.length,
                            },
                        }));
                    }).catch(function (err) {
                        console.warn("Failed to cache " + url + ": " + err.name + " " + err.message + " - scrubbing cache");
                        // This is probably a QuotaExceededError. Scrub the cache, in theory it'll come back next time round.
                        return window.caches.delete('ajaxapi-v1');
                    }).then(function () {
                        return response.json();
                    });
                });
            });
        });
    };

    /** Return URI of all currently cached URIs */
    this.listCached = function () {
        if (!window.caches) {
            return Promise.resolve([]);
        }

        return window.caches.open('ajaxapi-v1').then(function (cache) {
            return cache.keys().then(function (keys) {
                return new Set(keys.map(function (request) {
                    return request.url;
                }));
            });
        });
    };

    /** Remove anything from the cache not in the set/list */
    this.removeUnusedCache = function (expected_uris, invert) {
        var expected_full_uris = new Set();

        if (!window.caches) {
            return Promise.resolve([]);
        }

        // Convert /api/moo to https://.../api/moo
        expected_uris.forEach(function (u) {
            expected_full_uris.add((new window.URL(u, document.baseURI)).href);
        });

        return window.caches.open('ajaxapi-v1').then(function (cache) {
            return cache.keys().then(function (keys) {
                return Promise.all(keys.filter(function (request) {
                    return invert ? expected_full_uris.has(request.url) : !expected_full_uris.has(request.url);
                }.bind(this)).map(function (request) {
                    return cache.delete(request);
                }.bind(this)));
            });
        });
    };

    /** Call $.ajax with combined arguments, return promise-wrapped output */
    this.ajax = function (ajax_opts, extra_opts) {
        var args = {
            timeout: 5000,
        };
        Object.keys(ajax_opts || {}).map(function (k) { args[k] = ajax_opts[k]; });
        Object.keys(extra_opts || {}).map(function (k) { args[k] = extra_opts[k]; });

        return new Promise(function (resolve, reject) {
            if (window.navigator && !window.navigator.onLine) {
                reject(new Error("tutorweb::neterror::Currently offline"));
            }

            jqAjax(args).then(function (data) {
                resolve(data);
            }).fail(function (jqXHR, textStatus, errorThrown) {
                var err;

                if (jqXHR.responseJSON && jqXHR.responseJSON.error) {
                    // Response was JSON, so use what's inside
                    errorThrown = jqXHR.responseJSON.error.message;
                    textStatus = jqXHR.responseJSON.error.stack;
                }

                if (jqXHR.status === 401 || jqXHR.status === 403) {
                    if (errorThrown === "HTTPForbidden: User has not accepted terms") {
                        err = new Error("tutorweb::notacceptedterms::You have not accepted the Tutor-Web terms and conditions");

                    } else {
                        // Unauth / wrong user
                        err = new Error("tutorweb::unauth::" + textStatus + ". Please " +
                                         '<a href="' + '//' + window.document.location.host + '/login' +
                                         '?came_from=' + encodeURIComponent(window.document.location) +
                                         (/user \w+$/i.test(textStatus) ? '&login_name=' + textStatus.match(/for user (\w+)/i)[1] : '') +
                                         '">click here to log-in</a> before continuing.::html');
                    }
                } else if (textStatus === 'timeout') {
                    err = new Error("tutorweb::neterror::Timeout whilst fetching " + args.url);
                } else if (!errorThrown && jqXHR.status === 0 && textStatus === 'error') {
                    // Network error / request cancelled
                    err = new Error("tutorweb::neterror::Failed to fetch " + args.url);
                } else {
                    err = new Error("tutorweb::error::" + errorThrown + " whilst fetching " + args.url + ": " + textStatus);
                }

                // Add common attributes and throw
                err.url = args.url;
                err.server_class = errorThrown;
                reject(err);
            });
        });
    };
};
