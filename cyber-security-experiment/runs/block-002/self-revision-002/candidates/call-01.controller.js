/* Deterministic causal controller: all state below is inferred from replies. */
bp.registerBThread("atomic-two-zone-recovery", function () {
  // Confirmed prefixes of live workspaces, and the last atomic durable checkpoint.
  var a = 0, b = 0, savedA = 0, savedB = 0;
  var done = false;

  function call(requestName) {
    bp.sync({request: E(requestName), block: RESPONSES});
    return bp.sync({waitFor: RESPONSES, block: REQUESTS});
  }

  function nameOf(event) {
    return String(event.name);
  }

  function restoreCheckpoint() {
    // A restore always uses the most recently acknowledged, atomic snapshot.
    var reply = call("POST /response-snapshot/restore");
    if (nameOf(reply).indexOf("201 Restored") === 0) {
      a = savedA;
      b = savedB;
    }
  }

  function rotateThenRestore() {
    // Expiry invalidates both live workspaces but not the durable snapshot.
    var reply = call("POST /credentials/rotate");
    if (nameOf(reply).indexOf("200 Rotated") === 0) {
      restoreCheckpoint();
    }
  }

  function checkpoint() {
    var reply = call("POST /response-snapshot");
    var responseName = nameOf(reply);
    if (responseName.indexOf("201 Snapshotted") === 0) {
      savedA = a;
      savedB = b;
      return true;
    }
    // These branches are defensive; normal calls are made only with valid workspaces.
    if (responseName.indexOf("401 ") === 0) {
      rotateThenRestore();
    } else if (responseName.indexOf("409 ") === 0) {
      restoreCheckpoint();
    }
    return false;
  }

  function create(zone) {
    var reply;
    do {
      reply = call("POST /mitigation/" + zone);
      // The one permitted 503 leaves the requested workspace absent; retry it.
    } while (nameOf(reply).indexOf("201 Created") !== 0);
  }

  create("A");
  create("B");
  checkpoint();                         // Durable (0,0), before any protected stage.

  while (!done) {
    // Fixed ordering makes the choice deterministic; a checkpoint prevents lost peer work.
    var zone = a < 2 ? "A" : "B";
    var wanted = zone === "A" ? a + 1 : b + 1;
    var reply = call("PUT /mitigation/" + zone + "/stage/" + wanted);
    var responseName = nameOf(reply);

    if (responseName.indexOf("204 Applied") === 0) {
      if (zone === "A") { a = wanted; } else { b = wanted; }
      checkpoint();
    } else if (responseName.indexOf("504 ") === 0) {
      // Timeout is not counted until this immediately following status resolves it.
      var status = call("GET /mitigation/" + zone + "/status");
      var match = /([012])\s*$/.exec(nameOf(status));
      if (match && Number(match[1]) === wanted) {
        if (zone === "A") { a = wanted; } else { b = wanted; }
        checkpoint();
      }
      // Otherwise the known prefix is unchanged and the next iteration retries it.
    } else if (responseName.indexOf("401 ") === 0) {
      rotateThenRestore();
    } else if (responseName.indexOf("409 ") === 0) {
      // Eviction names an arbitrary victim, so restore both zones atomically.
      restoreCheckpoint();
    }

    if (a === 2 && b === 2) {
      reply = call("POST /traffic/reopen");
      if (nameOf(reply).indexOf("201 Traffic reopened") === 0) {
        done = true;                    // No requests after the sole success event.
      } else if (nameOf(reply).indexOf("401 ") === 0) {
        rotateThenRestore();
      } else if (nameOf(reply).indexOf("409 ") === 0) {
        restoreCheckpoint();
      }
    }
  }
  /* Worst case: 12 normal requests (creates, five snapshots, stages, reopen)
     +1 flood +2 unresolved timeout +3 expiry +2 eviction = 20. */
});
