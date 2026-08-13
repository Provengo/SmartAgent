/*
 * One controller b-thread.  prefixA/prefixB are the last *snapshotted*
 * confirmed prefixes; haveSnapshot says that those prefixes are restorable.
 * Checkpointing at 0 and after every stage bounds the four one-shot faults:
 * 12 normal requests + 503 retry + timeout/status/retry + eviction/restore/retry
 * + expiry/rotate/restore/retry = 20 requests in the worst compatible order.
 */
bp.registerBThread("deterministic causal recovery controller", function () {
    var prefixA = 0;
    var prefixB = 0;
    var haveSnapshot = false;
    var checkpointNeeded = true;

    // A turn always selects a request, then observes exactly its one response.
    function turn(requestName) {
        bp.sync({request: E(requestName), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }

    function nameOf(event) {
        return event.name || "";
    }

    function is(event, code) {
        return nameOf(event).indexOf(code + " ") === 0;
    }

    // Creation is retried only on its single legal transient failure.
    function createBothAtZero() {
        var response;
        do {
            response = turn("POST /mitigation/A");
        } while (is(response, "503"));
        do {
            response = turn("POST /mitigation/B");
        } while (is(response, "503"));
        prefixA = 0;
        prefixB = 0;
        haveSnapshot = false;
        checkpointNeeded = true;
    }

    // After expiry, restore the remembered checkpoint; without one, rebuild.
    function recoverCheckpoint() {
        var response = turn("POST /credentials/rotate");
        // Rotation's legal response is 200 Rotated.
        while (!is(response, "200")) {
            response = turn("POST /credentials/rotate");
        }

        if (!haveSnapshot) {
            createBothAtZero();
            return;
        }

        response = turn("POST /response-snapshot/restore");
        if (is(response, "201")) {
            checkpointNeeded = false;
        } else if (is(response, "401")) {
            // Defensive legal-response handling: rotate again before restore.
            recoverCheckpoint();
        } else {
            // 409 means no usable durable checkpoint, so restart at prefix 0.
            createBothAtZero();
        }
    }

    createBothAtZero();

    for (;;) {
        var response;

        if (checkpointNeeded) {
            response = turn("POST /response-snapshot");
            if (is(response, "201")) {
                haveSnapshot = true;
                checkpointNeeded = false;
                continue;
            }
            if (is(response, "401")) {
                recoverCheckpoint();
                continue;
            }
            // Invalid workspaces cannot be trusted as a checkpoint.
            createBothAtZero();
            continue;
        }

        if (prefixA === 2 && prefixB === 2) {
            response = turn("POST /traffic/reopen");
            if (is(response, "201")) {
                // 201 Traffic reopened is the terminal success event.
                return;
            }
            if (is(response, "401")) {
                recoverCheckpoint();
            } else {
                // Unsafe reopen contradicts this checkpoint; restore it first.
                if (haveSnapshot) {
                    response = turn("POST /response-snapshot/restore");
                    if (is(response, "201")) {
                        checkpointNeeded = false;
                    } else if (is(response, "401")) {
                        recoverCheckpoint();
                    } else {
                        createBothAtZero();
                    }
                } else {
                    createBothAtZero();
                }
            }
            continue;
        }

        // Fixed A-then-B order makes the policy deterministic and causal.
        var zone = prefixA < 2 ? "A" : "B";
        var nextPrefix = zone === "A" ? prefixA + 1 : prefixB + 1;
        response = turn("PUT /mitigation/" + zone + "/stage/" + nextPrefix);

        if (is(response, "204")) {
            if (zone === "A") {
                prefixA = nextPrefix;
            } else {
                prefixB = nextPrefix;
            }
            checkpointNeeded = true;
            continue;
        }

        if (is(response, "401")) {
            // Credential rotation invalidates both ordinary workspaces.
            recoverCheckpoint();
            continue;
        }

        if (is(response, "409")) {
            // Eviction applied no stage: restore the last atomic checkpoint.
            if (haveSnapshot) {
                response = turn("POST /response-snapshot/restore");
                if (is(response, "201")) {
                    checkpointNeeded = false;
                } else if (is(response, "401")) {
                    recoverCheckpoint();
                } else {
                    createBothAtZero();
                }
            } else {
                createBothAtZero();
            }
            continue;
        }

        // A 504 is ambiguous: status is the causal observation that resolves it.
        response = turn("GET /mitigation/" + zone + "/status");
        if (is(response, "401")) {
            recoverCheckpoint();
            continue;
        }
        if (is(response, "200")) {
            var status = nameOf(response);
            var reported = /\b2\b/.test(status) ? 2 : (/\b1\b/.test(status) ? 1 : 0);
            if (reported >= nextPrefix) {
                if (zone === "A") {
                    prefixA = reported;
                } else {
                    prefixB = reported;
                }
                checkpointNeeded = true;
            }
            // Otherwise the loop deterministically retries the unconfirmed stage.
        } else if (is(response, "409")) {
            // Defensive branch for a reported invalid workspace.
            createBothAtZero();
        }
    }
});
