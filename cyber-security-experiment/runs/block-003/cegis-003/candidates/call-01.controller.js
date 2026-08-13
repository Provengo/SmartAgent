bp.registerBThread("deterministic coupled-zone recovery controller", function () {
    // -1 means no usable workspace; 0, 1, and 2 are confirmed stage prefixes.
    let a = -1;
    let b = -1;
    let compromised = false;
    let evicted = null;

    // Worst case is 7 normal requests + 1 flood + 2 timeout resolution/retry
    // + 3 eviction repair + 7 credential-reset recovery = exactly 20 requests.

    function send(requestName) {
        bp.sync({request: E(requestName), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }

    function is(response, text) {
        return response.name === text;
    }

    function is401(response) {
        return response.name.indexOf("401 ") === 0;
    }

    function is503(response) {
        return response.name.indexOf("503 ") === 0;
    }

    function is504(response) {
        return response.name.indexOf("504 ") === 0;
    }

    function is409(response) {
        return response.name.indexOf("409 ") === 0;
    }

    function observedPrefix(response, requestedStage) {
        // After a timeout, status can only be the prior prefix or this stage.
        // Test for the requested digit as a complete number, not the 200 code.
        let digit = String(requestedStage);
        let pattern = new RegExp("(^|[^0-9])" + digit + "([^0-9]|$)");
        return pattern.test(response.name) ? requestedStage : requestedStage - 1;
    }

    function create(zone) {
        let response = send("POST /mitigation/" + zone);
        if (is401(response)) {
            compromised = true;
            return -1;
        }
        // 503 leaves the old remembered value (-1), so this choice is retried.
        if (is503(response)) {
            return -1;
        }
        return 0; // The remaining legal create response is 201 Created.
    }

    function stage(zone, prefix) {
        let next = prefix + 1;
        let response = send("PUT /mitigation/" + zone + "/stage/" + next);

        if (is(response, "204 Applied")) {
            return next;
        }
        if (is401(response)) {
            compromised = true;
            return prefix;
        }
        if (is504(response)) {
            // The mandatory status observation resolves the otherwise hidden outcome.
            let status = send("GET /mitigation/" + zone + "/status");
            if (is401(status)) {
                compromised = true;
                return prefix;
            }
            return observedPrefix(status, next);
        }

        // 409 is capacity eviction: no stage was applied and one named workspace died.
        if (is409(response)) {
            evicted = response.name.indexOf("A") !== -1 ? "A" : "B";
        }
        return prefix;
    }

    while (true) {
        if (compromised) {
            // Rotation changes the shared epoch, invalidating every ordinary workspace.
            send("POST /credentials/rotate");
            a = -1;
            b = -1;
            compromised = false;
            continue;
        }

        // Both workspaces are established before either stage is selected.
        if (a === -1) {
            a = create("A");
            continue;
        }
        if (b === -1) {
            b = create("B");
            continue;
        }

        // Fixed A-then-B order makes the policy deterministic and causal.
        if (a < 2) {
            evicted = null;
            let nextA = stage("A", a);
            if (evicted === "A") {
                a = -1;
            } else {
                a = nextA;
            }
            if (evicted === "B") {
                b = -1;
            }
            continue;
        }
        if (b < 2) {
            evicted = null;
            let nextB = stage("B", b);
            if (evicted === "B") {
                b = -1;
            } else {
                b = nextB;
            }
            if (evicted === "A") {
                a = -1;
            }
            continue;
        }

        let reopened = send("POST /traffic/reopen");
        if (is(reopened, "201 Traffic reopened")) {
            return; // Required terminal event: issue no further requests.
        }
        if (is401(reopened)) {
            compromised = true;
            continue;
        }

        // Defensive total recovery for the only other legal reopen result, 409 Unsafe.
        a = -1;
        b = -1;
    }
});
