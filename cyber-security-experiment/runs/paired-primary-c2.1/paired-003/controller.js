/* Deterministic C2 recovery controller.  All remembered values are primitives. */
bp.registerBThread("causal-c2-controller", function () {
    // done is the confirmed sequential prefix: create A, create B, A1, A2, B1, B2.
    var done = 0;
    // snap is the durable confirmed prefix; a restore returns precisely this prefix.
    var snap = 0;
    var hasSnapshot = false;
    // mode: 0 normal, 1 rotate credentials, 2 restore snapshot, 3 resolve timeout.
    var mode = 0;
    var pending = 0;
    var observed = null;
    var completed = false;

    while (!completed) {
        if (mode === 1) {
            bp.sync({request: E("POST /credentials/rotate"), block: RESPONSES});
            observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
            // Rotation is the only unprotected operation; resume from durable state.
            if (observed.name === "200 Rotated") {
                if (hasSnapshot) {
                    mode = 2;
                } else {
                    done = 0;
                    mode = 0;
                }
            }
        } else if (mode === 2) {
            bp.sync({request: E("POST /response-snapshot/restore"), block: RESPONSES});
            observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
            if (observed.name === "201 Restored") {
                done = snap;
                mode = 0;
            } else if (observed.name === "401 Credential compromised") {
                mode = 1;
            } else if (observed.name === "409 No snapshot") {
                // Defensive branch: rebuild if a supposedly durable snapshot is absent.
                done = 0;
                snap = 0;
                hasSnapshot = false;
                mode = 0;
            }
        } else if (mode === 3) {
            if (pending === 3 || pending === 4) {
                bp.sync({request: E("GET /mitigation/A/status"), block: RESPONSES});
            } else {
                bp.sync({request: E("GET /mitigation/B/status"), block: RESPONSES});
            }
            observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
            if (observed.name === "401 Credential compromised") {
                mode = 1;
            } else {
                // A timeout is counted only when status includes its requested prefix.
                if ((pending === 3 || pending === 5) && observed.name.indexOf("1") >= 0) {
                    done = pending;
                } else if ((pending === 4 || pending === 6) && observed.name.indexOf("2") >= 0) {
                    done = pending;
                }
                mode = 0;
            }
        } else if (done >= 2 && snap < done) {
            // Checkpoint every newly confirmed stage, minimizing later rollback.
            bp.sync({request: E("POST /response-snapshot"), block: RESPONSES});
            observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
            if (observed.name === "201 Snapshotted") {
                snap = done;
                hasSnapshot = true;
            } else if (observed.name === "401 Credential compromised") {
                mode = 1;
            } else if (observed.name === "409 Invalid workspace") {
                if (hasSnapshot) {
                    mode = 2;
                } else {
                    done = 0;
                }
            }
        } else if (done === 6) {
            bp.sync({request: E("POST /traffic/reopen"), block: RESPONSES});
            observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
            if (observed.name === "201 Traffic reopened") {
                completed = true;
            } else if (observed.name === "401 Credential compromised") {
                mode = 1;
            } else if (observed.name === "409 Unsafe to reopen") {
                // This cannot occur with the tracked prefix, but retry from checkpoint.
                if (hasSnapshot) {
                    mode = 2;
                } else {
                    done = 0;
                }
            }
        } else {
            pending = done + 1;
            if (pending === 1) {
                bp.sync({request: E("POST /mitigation/A"), block: RESPONSES});
            } else if (pending === 2) {
                bp.sync({request: E("POST /mitigation/B"), block: RESPONSES});
            } else if (pending === 3) {
                bp.sync({request: E("PUT /mitigation/A/stage/1"), block: RESPONSES});
            } else if (pending === 4) {
                bp.sync({request: E("PUT /mitigation/A/stage/2"), block: RESPONSES});
            } else if (pending === 5) {
                bp.sync({request: E("PUT /mitigation/B/stage/1"), block: RESPONSES});
            } else {
                bp.sync({request: E("PUT /mitigation/B/stage/2"), block: RESPONSES});
            }
            observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
            if (observed.name === "401 Credential compromised") {
                mode = 1;
            } else if (observed.name === "504 Edge timeout") {
                // Status, rather than assumption, resolves the ambiguous stage result.
                mode = 3;
            } else if (observed.name.indexOf("409 Capacity eviction") >= 0) {
                if (hasSnapshot) {
                    mode = 2;
                } else {
                    done = 0;
                }
            } else if (observed.name === "503 Control-plane flood") {
                // Creation failed; keep done unchanged and retry deterministically.
                mode = 0;
            } else if (observed.name.indexOf("201 Created") >= 0 || observed.name === "204 Applied") {
                done = pending;
            }
        }
    }
});
