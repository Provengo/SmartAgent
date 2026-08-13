bp.registerBThread("deterministic coupled-zone recovery controller", function () {
    // Confirmed prefixes; -1 means that this epoch has no usable workspace.
    var a = -1, b = -1;
    // The only durable checkpoint this policy creates is the confirmed (1,1) pair.
    var checkpoint = false;
    var compromised = false;
    var restoreNeeded = false;
    // One use each of 503, 401, 504, and eviction adds at most 1+4+2+2
    // requests to the eight-request clean path, so this policy stays below 20.

    function nameOf(event) {
        return String(event.name);
    }

    function request(path) {
        bp.sync({request: E(path), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }

    function isCompromised(response) {
        return nameOf(response).indexOf("401 ") === 0;
    }

    function isEviction(response) {
        return nameOf(response).indexOf("409 Capacity eviction") === 0;
    }

    function statusPrefix(response) {
        // Ignore the HTTP code, then accept the contract's textual status form.
        var text = nameOf(response).replace(/^\d+\s+/, "");
        if (/(prefix|stage|status)[^0-9]*2\b/i.test(text)) return 2;
        if (/(prefix|stage|status)[^0-9]*1\b/i.test(text)) return 1;
        return 0;
    }

    function rememberStage(zone, prefix) {
        if (zone === "A") a = prefix;
        else b = prefix;
    }

    function prefixOf(zone) {
        return zone === "A" ? a : b;
    }

    while (true) {
        var action, response, zone, before;

        // A 401 makes every ordinary workspace stale; rotate before any retry.
        if (compromised) {
            response = request("POST /credentials/rotate");
            if (nameOf(response).indexOf("200 Rotated") === 0) {
                compromised = false;
                if (checkpoint) restoreNeeded = true;
                else { a = -1; b = -1; }
            }
            continue;
        }

        // Restoring is atomic, so it deliberately discards any newer lone prefix.
        if (restoreNeeded) {
            response = request("POST /response-snapshot/restore");
            if (isCompromised(response)) { compromised = true; continue; }
            if (nameOf(response).indexOf("201 Restored") === 0) {
                a = 1; b = 1; restoreNeeded = false;
            } else { // 409 No snapshot: rebuild conservatively.
                checkpoint = false; restoreNeeded = false; a = -1; b = -1;
            }
            continue;
        }

        if (a < 0 || b < 0) {
            zone = a < 0 ? "A" : "B";
            response = request("POST /mitigation/" + zone);
            if (isCompromised(response)) { compromised = true; continue; }
            // 503 is globally single-use, so retaining -1 deterministically retries.
            if (nameOf(response).indexOf("201 Created") === 0) rememberStage(zone, 0);
            continue;
        }

        // Do not risk stage 2 until the coupled stage-1 checkpoint is durable.
        if (!checkpoint && a >= 1 && b >= 1) {
            response = request("POST /response-snapshot");
            if (isCompromised(response)) { compromised = true; continue; }
            if (nameOf(response).indexOf("201 Snapshotted") === 0) checkpoint = true;
            else { a = -1; b = -1; } // Invalid workspace is rebuilt before retrying.
            continue;
        }

        if (a < 2 || b < 2) {
            // Finish both first stages before either second stage.
            if (a < 1) zone = "A";
            else if (b < 1) zone = "B";
            else if (a < 2) zone = "A";
            else zone = "B";
            before = prefixOf(zone);
            action = "PUT /mitigation/" + zone + "/stage/" + (before + 1);
            response = request(action);

            if (isCompromised(response)) { compromised = true; continue; }
            if (nameOf(response).indexOf("204 Applied") === 0) {
                rememberStage(zone, before + 1);
            } else if (nameOf(response).indexOf("504 Edge timeout") === 0) {
                // A timeout is ambiguous: status is the required causal resolver.
                response = request("GET /mitigation/" + zone + "/status");
                if (isCompromised(response)) { compromised = true; continue; }
                rememberStage(zone, statusPrefix(response) >= before + 1 ? before + 1 : before);
            } else if (isEviction(response)) {
                // A checkpoint repairs either possible victim without trusting it.
                if (checkpoint) restoreNeeded = true;
                else {
                    if (nameOf(response).indexOf("(A)") >= 0 || /\bA\b/.test(nameOf(response))) a = -1;
                    else b = -1;
                }
            }
            continue;
        }

        response = request("POST /traffic/reopen");
        if (nameOf(response).indexOf("201 Traffic reopened") === 0) return;
        if (isCompromised(response)) { compromised = true; continue; }
        // Unsafe reopen cannot justify trusting stage 2; return to the checkpoint.
        if (checkpoint) restoreNeeded = true;
        else { a = -1; b = -1; }
    }
});
