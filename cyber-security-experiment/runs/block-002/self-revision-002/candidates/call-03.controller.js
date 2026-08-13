/* Deterministic controller for atomic two-zone recovery. */
bp.registerBThread("atomic-two-zone-recovery", function () {
  // These are only confirmed prefixes.  saved* is an acknowledged atomic snapshot.
  var a = 0;
  var b = 0;
  var savedA = 0;
  var savedB = 0;
  var haveSnapshot = false;
  var reopened = false;

  function ask(name) {
    bp.sync({request: E(name), block: RESPONSES});
    return bp.sync({waitFor: RESPONSES, block: REQUESTS});
  }

  function nameOf(event) {
    return String(event.name);
  }

  function is(event, prefix) {
    return nameOf(event).indexOf(prefix) === 0;
  }

  function prefixFromStatus(event) {
    // Contract status events end in Prefix(0), Prefix(1), or Prefix(2).
    var text = nameOf(event);
    return Number(text.charAt(text.length - 2));
  }

  function rotate() {
    // Rotation is the only request permitted while credentials are compromised.
    ask("POST /credentials/rotate");
  }

  function restoreSnapshot() {
    var reply = ask("POST /response-snapshot/restore");
    if (is(reply, "201 Restored")) {
      a = savedA;
      b = savedB;
      return true;
    }
    // With haveSnapshot true, 409 is not a legal causal outcome.  A 401 can
    // only be followed by rotation; retain no unconfirmed live-prefix claim.
    if (is(reply, "401 ")) {
      rotate();
    }
    return false;
  }

  function recoverAfterExpiry() {
    rotate();
    // All ordinary workspaces were invalidated by the shared epoch advance.
    if (haveSnapshot) {
      restoreSnapshot();
    }
  }

  function create(zone) {
    var reply;
    while (true) {
      reply = ask("POST /mitigation/" + zone);
      if (is(reply, "201 Created")) {
        return true;
      }
      if (is(reply, "401 ")) {
        return false;
      }
      // The sole 503 leaves the requested workspace absent, so retry it.
    }
  }

  function establishInitialSnapshot() {
    // This loop also safely handles an expiry encountered before any snapshot:
    // rotation invalidates a possibly-created first workspace, so build both again.
    while (!haveSnapshot) {
      if (!create("A")) {
        rotate();
        continue;
      }
      if (!create("B")) {
        rotate();
        continue;
      }
      var reply = ask("POST /response-snapshot");
      if (is(reply, "201 Snapshotted")) {
        savedA = 0;
        savedB = 0;
        a = 0;
        b = 0;
        haveSnapshot = true;
      } else if (is(reply, "401 ")) {
        rotate();
      }
      // A 409 means the server did not accept a valid pair; rebuild rather
      // than treating either local workspace as usable.
    }
  }

  function checkpoint() {
    var reply = ask("POST /response-snapshot");
    if (is(reply, "201 Snapshotted")) {
      savedA = a;
      savedB = b;
    } else if (is(reply, "401 ")) {
      recoverAfterExpiry();
    } else if (is(reply, "409 ")) {
      // A capacity eviction cannot occur on snapshot, but never advance based
      // on a rejected checkpoint; restore the last known atomic state.
      restoreSnapshot();
    }
  }

  function apply(zone, wanted) {
    var reply = ask("PUT /mitigation/" + zone + "/stage/" + wanted);
    if (is(reply, "204 Applied")) {
      if (zone === "A") { a = wanted; } else { b = wanted; }
      checkpoint();
    } else if (is(reply, "504 ")) {
      // A timeout is ambiguous until this required immediate status observation.
      var status = ask("GET /mitigation/" + zone + "/status");
      if (is(status, "401 ")) {
        recoverAfterExpiry();
      } else if (prefixFromStatus(status) === wanted) {
        if (zone === "A") { a = wanted; } else { b = wanted; }
        checkpoint();
      }
      // The prior prefix means no local update and the main loop retries it.
    } else if (is(reply, "401 ")) {
      recoverAfterExpiry();
    } else if (is(reply, "409 ")) {
      // The response identifies a victim, but the snapshot reconstructs both.
      restoreSnapshot();
    }
  }

  establishInitialSnapshot();

  while (!reopened) {
    var zone = a < 2 ? "A" : "B";
    var wanted = zone === "A" ? a + 1 : b + 1;
    apply(zone, wanted);

    if (a === 2 && b === 2) {
      var reply = ask("POST /traffic/reopen");
      if (is(reply, "201 Traffic reopened")) {
        reopened = true;
      } else if (is(reply, "401 ")) {
        recoverAfterExpiry();
      } else if (is(reply, "409 ")) {
        restoreSnapshot();
      }
    }
  }

  /* Normal path: 2 creates + initial snapshot + 4 (stage,snapshot) + reopen = 12.
     The single 503 adds 1; a non-applied timeout adds status and retry (2);
     eviction adds restore and retry/checkpoint (2); expiry adds rotate, restore,
     and retry/checkpoint (3).  Total worst case: 20 requests. */
});
