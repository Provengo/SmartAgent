/*
 * Causal recovery controller.  Prefixes are only advanced from an observed
 * 204 (or the status read which resolves a 504); snapA/snapB are the last
 * durable, jointly confirmed checkpoint.
 */
bp.registerBThread("causal-two-zone-recovery", function () {
    var a = 0, b = 0;
    var snapA = 0, snapB = 0, haveSnapshot = false;
    var validA = false, validB = false;
    var dirty = false; // true exactly when current confirmed prefixes need a checkpoint

    function nameOf(e) {
        return e.name;
    }

    // One request is always followed by exactly one observed response.
    function call(requestName) {
        bp.sync({request: E(requestName), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }

    function statusPrefix(response) {
        var text = nameOf(response);
        var match = /prefix\D*([012])\b/i.exec(text);
        if (!match) {
            // Status response names end in the reported prefix in this contract.
            match = /([012])\D*$/.exec(text);
        }
        return match ? Number(match[1]) : 0;
    }

    function restoreCheckpoint() {
        if (!haveSnapshot) {
            validA = false;
            validB = false;
            return;
        }
        var response = call("POST /response-snapshot/restore");
        if (nameOf(response) === "201 Restored") {
            a = snapA;
            b = snapB;
            validA = true;
            validB = true;
            dirty = false;
        } else if (nameOf(response) === "401 Credential compromised") {
            recoverCredentials();
        } else { // 409 No snapshot: discard an unusable remembered checkpoint.
            haveSnapshot = false;
            validA = false;
            validB = false;
        }
    }

    function recoverCredentials() {
        // Rotation advances the epoch, so no ordinary workspace remains valid.
        call("POST /credentials/rotate");
        validA = false;
        validB = false;
        dirty = false;
        // A durable snapshot can be restored into the newly rotated epoch.
        restoreCheckpoint();
    }

    function applyStage(zone, stage) {
        var response = call("PUT /mitigation/" + zone + "/stage/" + stage);
        var responseName = nameOf(response);
        if (responseName === "204 Applied") {
            if (zone === "A") a = stage; else b = stage;
            dirty = true;
        } else if (responseName === "401 Credential compromised") {
            recoverCredentials();
        } else if (responseName === "504 Edge timeout") {
            // The immediately following status observation decides whether it applied.
            var status = call("GET /mitigation/" + zone + "/status");
            if (nameOf(status) === "401 Credential compromised") {
                recoverCredentials();
            } else {
                if (zone === "A") a = statusPrefix(status); else b = statusPrefix(status);
                dirty = (a !== snapA || b !== snapB);
            }
        } else { // 409 Capacity eviction(victim): restore both zones atomically.
            restoreCheckpoint();
        }
    }

    while (true) {
        if (!validA) {
            var createA = call("POST /mitigation/A");
            if (/^201 Created\b/.test(nameOf(createA))) {
                validA = true;
                a = 0;
                dirty = true;
            } else if (nameOf(createA) === "401 Credential compromised") {
                recoverCredentials();
            } // 503 leaves A invalid and deterministically retries it.
            continue;
        }

        if (!validB) {
            var createB = call("POST /mitigation/B");
            if (/^201 Created\b/.test(nameOf(createB))) {
                validB = true;
                b = 0;
                dirty = true;
            } else if (nameOf(createB) === "401 Credential compromised") {
                recoverCredentials();
            } // 503 leaves B invalid and deterministically retries it.
            continue;
        }

        if (dirty) {
            var saved = call("POST /response-snapshot");
            if (nameOf(saved) === "201 Snapshotted") {
                snapA = a;
                snapB = b;
                haveSnapshot = true;
                dirty = false;
            } else if (nameOf(saved) === "401 Credential compromised") {
                recoverCredentials();
            } else { // 409 Invalid workspace: recover from the last checkpoint.
                validA = false;
                validB = false;
                dirty = false;
            }
            continue;
        }

        if (a < 2) {
            applyStage("A", a + 1);
            continue;
        }
        if (b < 2) {
            applyStage("B", b + 1);
            continue;
        }

        var reopened = call("POST /traffic/reopen");
        if (nameOf(reopened) === "201 Traffic reopened") {
            break; // Required terminal condition: make no further requests.
        }
        if (nameOf(reopened) === "401 Credential compromised") {
            recoverCredentials();
        } else { // 409 Unsafe to reopen: local state is no longer trusted.
            validA = false;
            validB = false;
        }
    }
});
