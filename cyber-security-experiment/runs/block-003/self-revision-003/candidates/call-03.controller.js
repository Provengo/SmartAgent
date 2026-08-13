/*
 * a and b are confirmed prefixes in the live credential epoch; -1 means that
 * the workspace is not known to exist.  The snapshot is a durable, paired
 * checkpoint and may be restored into a later epoch.
 *
 * A checkpoint is taken before every stage.  Thus each disruptive stage
 * outcome can be recovered without losing any previously confirmed stage.
 * Normal completion takes 12 requests.  The one-off 503, 504, eviction, and
 * credential compromise add at most 1, 1, 2, and 3 requests respectively,
 * for a worst case of 19 (including reopen).
 */
bp.registerBThread("causal-two-zone-recovery", function () {
  var a = -1, b = -1;
  var snapA = 0, snapB = 0, haveSnapshot = false;
  var checkpointNeeded = false;
  var rotateNeeded = false, restoreNeeded = false;

  function call(requestName) {
    bp.sync({request: E(requestName), block: RESPONSES});
    return bp.sync({waitFor: RESPONSES, block: REQUESTS});
  }

  // BPjs event names can be Java strings, so normalize before comparing.
  function nameOf(event) {
    return String(event.name);
  }

  function compromised(response) {
    return nameOf(response) === "401 Credential compromised";
  }

  function forgetLive() {
    a = -1;
    b = -1;
    checkpointNeeded = false;
  }

  // Status is requested only immediately after a timeout.  Its final digit is
  // the authoritative prefix (the contract limits prefixes to 0, 1, and 2).
  function statusPrefix(response) {
    var s = nameOf(response);
    var i = s.lastIndexOf("Prefix(");
    if (i < 0 || s.charAt(s.length - 1) !== ")") return -1;
    var digit = s.charAt(s.length - 2);
    return digit === "0" ? 0 : (digit === "1" ? 1 : (digit === "2" ? 2 : -1));
  }

  function setPrefix(zone, value) {
    if (zone === "A") a = value;
    else b = value;
  }

  function prefixOf(zone) {
    return zone === "A" ? a : b;
  }

  while (true) {
    var response, responseName, zone, next, before, resolved;

    // Rotation is the only request allowed while credentials are compromised.
    if (rotateNeeded) {
      response = call("POST /credentials/rotate");
      if (nameOf(response) === "200 Rotated") {
        forgetLive();
        rotateNeeded = false;
        restoreNeeded = haveSnapshot;
      }
      continue;
    }

    // Restoring deliberately replaces both zones, including any newer prefix
    // on the zone which was not evicted.
    if (restoreNeeded) {
      response = call("POST /response-snapshot/restore");
      responseName = nameOf(response);
      if (responseName === "201 Restored") {
        a = snapA;
        b = snapB;
        checkpointNeeded = false;
        restoreNeeded = false;
      } else if (compromised(response)) {
        forgetLive();
        rotateNeeded = true;
      } else { // 409 No snapshot: local checkpoint can no longer be trusted.
        haveSnapshot = false;
        restoreNeeded = false;
        forgetLive();
      }
      continue;
    }

    // A 503 leaves all known workspace state unchanged; retry creation.
    if (a < 0 || b < 0) {
      zone = a < 0 ? "A" : "B";
      response = call("POST /mitigation/" + zone);
      responseName = nameOf(response);
      if (responseName === "201 Created (" + zone + ")") setPrefix(zone, 0);
      else if (compromised(response)) {
        forgetLive();
        rotateNeeded = true;
      }
      continue;
    }

    // Save the complete current pair before the next potentially disruptive
    // stage request, and after a timeout which was observed to apply.
    if (!haveSnapshot || checkpointNeeded) {
      response = call("POST /response-snapshot");
      responseName = nameOf(response);
      if (responseName === "201 Snapshotted") {
        snapA = a;
        snapB = b;
        haveSnapshot = true;
        checkpointNeeded = false;
      } else if (compromised(response)) {
        forgetLive();
        rotateNeeded = true;
      } else { // 409 Invalid workspace
        if (haveSnapshot) restoreNeeded = true;
        else forgetLive();
      }
      continue;
    }

    if (a < 2 || b < 2) {
      zone = a < 2 ? "A" : "B";
      before = prefixOf(zone);
      next = before + 1;
      response = call("PUT /mitigation/" + zone + "/stage/" + next);
      responseName = nameOf(response);

      if (responseName === "204 Applied") {
        setPrefix(zone, next);
        checkpointNeeded = true;
      } else if (responseName === "504 Edge timeout") {
        // Never infer the outcome of an ambiguous stage; observe it first.
        response = call("GET /mitigation/" + zone + "/status");
        if (compromised(response)) {
          forgetLive();
          rotateNeeded = true;
        } else {
          resolved = statusPrefix(response);
          if (resolved >= 0) {
            setPrefix(zone, resolved);
            // If it did not apply, the existing checkpoint remains exact.
            checkpointNeeded = resolved !== before;
          } else if (haveSnapshot) {
            restoreNeeded = true;
          } else {
            forgetLive();
          }
        }
      } else if (compromised(response)) {
        forgetLive();
        rotateNeeded = true;
      } else if (responseName.indexOf("409 Capacity eviction(A)") === 0) {
        a = -1;
        restoreNeeded = haveSnapshot;
      } else if (responseName.indexOf("409 Capacity eviction(B)") === 0) {
        b = -1;
        restoreNeeded = haveSnapshot;
      } else { // 409 Invalid workspace (defensive, though unreachable here)
        if (haveSnapshot) restoreNeeded = true;
        else forgetLive();
      }
      continue;
    }

    response = call("POST /traffic/reopen");
    responseName = nameOf(response);
    if (responseName === "201 Traffic reopened") return;
    if (compromised(response)) {
      forgetLive();
      rotateNeeded = true;
    } else if (haveSnapshot) { // 409 Unsafe to reopen: recover conservatively.
      restoreNeeded = true;
    } else {
      forgetLive();
    }
  }
});
