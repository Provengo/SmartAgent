/* Deterministic defensive controller.  All state below is learned from replies. */
bp.registerBThread("causal two-zone recovery controller", function () {
    // -1 means no current-epoch workspace; 0..2 are confirmed applied prefixes.
    var a = -1;
    var b = -1;
    // The last durable, atomically confirmed pair.  It is retained across rotation.
    var snapA = -1;
    var snapB = -1;
    var restoreNeeded = false;
    var rotateNeeded = false;

    function nameOf(event) {
        return String(event.name);
    }

    // One request is always followed by exactly one observed response.
    function request(path) {
        bp.sync({request: E(path), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }

    function is(response, code) {
        return nameOf(response).indexOf(code + " ") === 0;
    }

    function evictionVictim(response) {
        var text = nameOf(response);
        if (/\bA\b/.test(text)) { return "A"; }
        if (/\bB\b/.test(text)) { return "B"; }
        return "";
    }

    // Status text carries a single prefix (0, 1, or 2) after its HTTP code.
    function reportedPrefix(response) {
        var detail = nameOf(response).replace(/^\d{3}\s+/, "");
        var labelled = detail.match(/(?:prefix|stage)\s*(?:=|:)?\s*([012])\b/i);
        var values = detail.match(/\b[012]\b/g);
        if (labelled) { return Number(labelled[1]); }
        if (values && values.length) { return Number(values[values.length - 1]); }
        return -1; // Never count an unparseable timeout outcome as applied.
    }

    while (true) {
        var observed;

        if (rotateNeeded) {
            observed = request("POST /credentials/rotate");
            // Rotation is the only unprotected request; its 200 starts a new epoch.
            if (is(observed, "200")) {
                a = -1;
                b = -1;
                rotateNeeded = false;
                restoreNeeded = true;
            }
            continue;
        }

        if (restoreNeeded) {
            observed = request("POST /response-snapshot/restore");
            if (is(observed, "201")) {
                a = snapA;
                b = snapB;
                restoreNeeded = false;
            } else if (is(observed, "401")) {
                rotateNeeded = true;
            } else {
                // Defensive legal 409 fallback: rebuild and establish a fresh checkpoint.
                a = -1;
                b = -1;
                snapA = -1;
                snapB = -1;
                restoreNeeded = false;
            }
            continue;
        }

        if (a < 0) {
            observed = request("POST /mitigation/A");
            if (is(observed, "201")) { a = 0; }
            else if (is(observed, "401")) { rotateNeeded = true; }
            // A lone 503 is retried; it creates no workspace and consumes no progress.
            continue;
        }
        if (b < 0) {
            observed = request("POST /mitigation/B");
            if (is(observed, "201")) { b = 0; }
            else if (is(observed, "401")) { rotateNeeded = true; }
            continue;
        }

        if (a === 2 && b === 2) {
            observed = request("POST /traffic/reopen");
            if (nameOf(observed) === "201 Traffic reopened") { break; }
            if (is(observed, "401")) { rotateNeeded = true; }
            else {
                // A legal unsafe reopen contradicts no confirmed state; re-check safely.
                restoreNeeded = true;
            }
            continue;
        }

        // Checkpoint every incomplete confirmed pair before exposing the next stage.
        if (a !== snapA || b !== snapB) {
            observed = request("POST /response-snapshot");
            if (is(observed, "201")) {
                snapA = a;
                snapB = b;
            } else if (is(observed, "401")) {
                rotateNeeded = true;
            } else {
                // Invalid-workspace fallback keeps local state conservative.
                a = -1;
                b = -1;
            }
            continue;
        }

        var zone = a < 2 ? "A" : "B";
        var prefix = zone === "A" ? a : b;
        observed = request("PUT /mitigation/" + zone + "/stage/" + (prefix + 1));

        if (is(observed, "204")) {
            if (zone === "A") { a = prefix + 1; }
            else { b = prefix + 1; }
        } else if (is(observed, "401")) {
            // The checkpoint was taken immediately before this vulnerable request.
            rotateNeeded = true;
        } else if (is(observed, "504")) {
            // A timeout is ambiguous: status, rather than this reply, decides the prefix.
            observed = request("GET /mitigation/" + zone + "/status");
            if (is(observed, "200")) {
                prefix = reportedPrefix(observed);
                if (prefix >= 0) {
                    if (zone === "A") { a = prefix; }
                    else { b = prefix; }
                } else {
                    restoreNeeded = true;
                }
            } else if (is(observed, "401")) {
                rotateNeeded = true;
            } else {
                restoreNeeded = true;
            }
        } else if (is(observed, "409")) {
            // Eviction applies no stage; restore the pre-stage atomic checkpoint.
            if (evictionVictim(observed) === "A") { a = -1; }
            else if (evictionVictim(observed) === "B") { b = -1; }
            restoreNeeded = true;
        }
    }
});
