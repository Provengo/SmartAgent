bp.registerBThread("deterministic coupled-zone recovery controller", function () {
    // -1 is absent; 0..2 are observed, current workspace prefixes.
    let a = -1, b = -1;
    let snapA = -1, snapB = -1; // The one durable coupled checkpoint.
    let compromised = false, evicted = null;

    function send(name) {
        bp.sync({request: E(name), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }
    function named(e, s) { return e.name.equals(s); }
    function is(e, code) { return e.name.indexOf(code + " ") === 0; }
    function prefix(e, requested) {
        let re = new RegExp("(^|[^0-9])" + requested + "([^0-9]|$)");
        return re.test(e.name) ? requested : requested - 1;
    }
    function create(zone) {
        let r = send("POST /mitigation/" + zone);
        if (is(r, "401")) { compromised = true; return -1; }
        return is(r, "503") ? -1 : 0;
    }
    function apply(zone, old) {
        let wanted = old + 1, r = send("PUT /mitigation/" + zone + "/stage/" + wanted);
        if (named(r, "204 Applied")) return wanted;
        if (is(r, "401")) { compromised = true; return old; }
        if (is(r, "504")) {
            let status = send("GET /mitigation/" + zone + "/status");
            if (is(status, "401")) { compromised = true; return old; }
            return prefix(status, wanted);
        }
        if (is(r, "409")) evicted = r.name.indexOf("(A)") !== -1 ? "A" : "B";
        return old;
    }
    function checkpoint() {
        let r = send("POST /response-snapshot");
        if (is(r, "401")) { compromised = true; return; }
        if (named(r, "201 Snapshotted")) { snapA = a; snapB = b; }
    }
    function restore() {
        let r = send("POST /response-snapshot/restore");
        if (is(r, "401")) { compromised = true; return; }
        if (named(r, "201 Restored")) { a = snapA; b = snapB; }
        else { snapA = -1; snapB = -1; a = -1; b = -1; }
    }

    while (true) {
        if (compromised) {
            send("POST /credentials/rotate");
            compromised = false;
            if (snapA >= 0) restore(); else { a = -1; b = -1; }
            continue;
        }
        if (a < 0) { a = create("A"); continue; }
        if (b < 0) { b = create("B"); continue; }

        // Once A is complete, preserve it before B can expose it to eviction.
        if (a === 2 && b === 0 && snapA < 0) { checkpoint(); continue; }

        if (a < 2 || b < 2) {
            let zone = a < 2 ? "A" : "B";
            evicted = null;
            let next = apply(zone, zone === "A" ? a : b);
            if (evicted !== null) {
                // Restore the coupled checkpoint when available; it avoids
                // rebuilding a completed zone and intentionally rolls back B.
                if (snapA >= 0) restore();
                else if (evicted === "A") a = -1;
                else b = -1;
            } else if (zone === "A") a = next;
            else b = next;
            continue;
        }

        let r = send("POST /traffic/reopen");
        if (named(r, "201 Traffic reopened")) return;
        if (is(r, "401")) compromised = true;
        else { a = -1; b = -1; snapA = -1; snapB = -1; }
    }
});
