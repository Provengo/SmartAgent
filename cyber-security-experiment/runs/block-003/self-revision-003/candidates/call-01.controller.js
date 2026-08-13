/* Deterministic controller: -1 means no trusted workspace; 0..2 is its
 * confirmed applied-stage prefix.  A compromise invalidates both prefixes. */
bp.registerBThread("causal-two-zone-recovery", function () {
  var a = -1;
  var b = -1;
  var rotateNeeded = false;

  // A request is always followed by one response before this controller acts again.
  function call(path) {
    bp.sync({request: E(path), block: RESPONSES});
    return bp.sync({waitFor: RESPONSES, block: REQUESTS});
  }

  function nameOf(event) {
    return event.name;
  }

  function compromised(event) {
    return nameOf(event) === "401 Credential compromised";
  }

  // Status replies end in the zone's confirmed prefix (0, 1, or 2).
  function reportedPrefix(event) {
    var m = nameOf(event).match(/([012])$/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // Capacity eviction names exactly one victim; only that prefix is forgotten.
  function recordEviction(event) {
    if (nameOf(event).indexOf("(A)") >= 0 || nameOf(event).indexOf(" A") >= 0) {
      a = -1;
    } else {
      b = -1;
    }
  }

  while (true) {
    var response;

    if (rotateNeeded) {
      response = call("POST /credentials/rotate");
      // A successful rotation starts a new shared epoch, so rebuild from zero.
      if (nameOf(response) === "200 Rotated") {
        a = -1;
        b = -1;
        rotateNeeded = false;
      }
      continue;
    }

    if (a < 0 || b < 0) {
      var zone = a < 0 ? "A" : "B";
      response = call("POST /mitigation/" + zone);
      if (compromised(response)) {
        rotateNeeded = true;
      } else if (nameOf(response).indexOf("201 Created") === 0) {
        if (zone === "A") a = 0;
        else b = 0;
      }
      // 503 is deliberately retried; it has not changed remembered state.
      continue;
    }

    if (a < 2 || b < 2) {
      // Finish A first, then B; both workspaces are known to exist here.
      var stageZone = a < 2 ? "A" : "B";
      var oldPrefix = stageZone === "A" ? a : b;
      var nextStage = oldPrefix + 1;
      response = call("PUT /mitigation/" + stageZone + "/stage/" + nextStage);

      if (compromised(response)) {
        rotateNeeded = true;
      } else if (nameOf(response) === "204 Applied") {
        if (stageZone === "A") a = nextStage;
        else b = nextStage;
      } else if (nameOf(response).indexOf("504 Edge timeout") === 0) {
        // Resolve the one ambiguous stage before counting it or issuing work.
        response = call("GET /mitigation/" + stageZone + "/status");
        if (compromised(response)) {
          rotateNeeded = true;
        } else if (stageZone === "A") {
          a = reportedPrefix(response);
        } else {
          b = reportedPrefix(response);
        }
      } else if (nameOf(response).indexOf("409 Capacity eviction") === 0) {
        recordEviction(response);
      }
      continue;
    }

    response = call("POST /traffic/reopen");
    if (nameOf(response) === "201 Traffic reopened") {
      return; // Terminal success: make no further requests.
    }
    if (compromised(response)) {
      rotateNeeded = true;
    } else {
      // Defensive branch for Unsafe to reopen: no longer rely on either prefix.
      a = -1;
      b = -1;
    }
  }
});
