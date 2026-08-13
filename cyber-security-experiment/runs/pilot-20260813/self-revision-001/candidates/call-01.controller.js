/*
 * Deterministic recovery controller.  The local prefixes are only values that
 * have been confirmed by responses; snapA/snapB are the last atomic checkpoint.
 * Nominal path: 11 requests.  The one-shot 503, 504, eviction, and 401 add at
 * most 1, 2, 2, and 4 requests respectively, so every combined path is <= 20.
 */
bp.registerBThread("causal two-zone recovery controller", function () {
  var a = 0, b = 0;
  var aliveA = false, aliveB = false;
  var snapA = -1, snapB = -1; // -1 means no durable checkpoint yet
  var compromised = false;

  while (true) {
    var request;
    var kind = "";
    var zone = "";

    if (compromised) {
      // A 401 makes rotation the only request the contract permits us to use.
      request = "POST /credentials/rotate";
      kind = "rotate";
    } else if ((!aliveA || !aliveB) && snapA >= 0) {
      // Eviction is cheaper and safer to repair by restoring the last checkpoint.
      request = "POST /response-snapshot/restore";
      kind = "restore";
    } else if (!aliveA) {
      request = "POST /mitigation/A";
      kind = "create";
      zone = "A";
    } else if (!aliveB) {
      request = "POST /mitigation/B";
      kind = "create";
      zone = "B";
    } else if (a === 2 && b === 2) {
      // A confirmed stage-2 pair is safe to reopen; no further checkpoint is needed.
      request = "POST /traffic/reopen";
      kind = "reopen";
    } else if (snapA !== a || snapB !== b) {
      // Checkpoint each joint confirmed prefix before exposing another stage.
      request = "POST /response-snapshot";
      kind = "snapshot";
    } else if (a < 2) {
      request = "PUT /mitigation/A/stage/" + (a + 1);
      kind = "stage";
      zone = "A";
    } else if (b < 2) {
      request = "PUT /mitigation/B/stage/" + (b + 1);
      kind = "stage";
      zone = "B";
    }

    bp.sync({request: E(request), block: RESPONSES});
    var observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
    var name = String(observed.name);

    if (name.indexOf("401 ") === 0) {
      // Rotation invalidates ordinary workspaces; the durable snapshot remains.
      compromised = true;
      aliveA = aliveB = false;
      a = b = 0;
      continue;
    }

    if (kind === "rotate") {
      // The only legal rotation success starts a new credential epoch.
      compromised = false;
      if (snapA >= 0) {
        bp.sync({request: E("POST /response-snapshot/restore"), block: RESPONSES});
        observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
        name = String(observed.name);
        if (name.indexOf("401 ") === 0) {
          compromised = true;
        } else if (name.indexOf("201 Restored") === 0) {
          aliveA = aliveB = true;
          a = snapA;
          b = snapB;
        } else { // Legal 409 No snapshot: discard the stale local checkpoint.
          snapA = snapB = -1;
          aliveA = aliveB = false;
          a = b = 0;
        }
      }
      continue;
    }

    if (kind === "create") {
      if (name.indexOf("201 Created") === 0) {
        if (zone === "A") { aliveA = true; a = 0; }
        else { aliveB = true; b = 0; }
      }
      // A legal 503 leaves all remembered state unchanged, so retry next turn.
      continue;
    }

    if (kind === "snapshot") {
      if (name.indexOf("201 Snapshotted") === 0) {
        snapA = a;
        snapB = b;
      } else if (name.indexOf("409 ") === 0) {
        // An invalid-workspace report is recovered from the older snapshot.
        aliveA = aliveB = false;
        a = b = 0;
      }
      continue;
    }

    if (kind === "restore") {
      if (name.indexOf("201 Restored") === 0) {
        aliveA = aliveB = true;
        a = snapA;
        b = snapB;
      } else if (name.indexOf("409 ") === 0) {
        snapA = snapB = -1;
        aliveA = aliveB = false;
        a = b = 0;
      }
      continue;
    }

    if (kind === "stage") {
      if (name.indexOf("204 Applied") === 0) {
        if (zone === "A") { a++; } else { b++; }
      } else if (name.indexOf("504 ") === 0) {
        // Status is mandatory here: its final numeric field is the resolved prefix.
        bp.sync({request: E("GET /mitigation/" + zone + "/status"), block: RESPONSES});
        observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
        name = String(observed.name);
        if (name.indexOf("401 ") === 0) {
          compromised = true;
          aliveA = aliveB = false;
          a = b = 0;
        } else {
          var numbers = name.match(/\d+/g);
          var prefix = numbers ? parseInt(numbers[numbers.length - 1], 10) : -1;
          // Legal status values are 0, 1, or 2; retain only the reported one.
          if (zone === "A") { a = prefix; } else { b = prefix; }
        }
      } else if (name.indexOf("409 ") === 0) {
        // Capacity eviction names its victim; a restore will use snapA/snapB.
        if (name.indexOf("(A)") >= 0) { aliveA = false; a = 0; }
        else { aliveB = false; b = 0; }
      }
      continue;
    }

    // Reopen has only two legal outcomes.  Success terminates all requests.
    if (kind === "reopen") {
      if (name.indexOf("201 Traffic reopened") === 0) { return; }
      // Defensive legal 409 branch: rebuild from the last causal checkpoint.
      aliveA = aliveB = false;
      a = b = 0;
    }
  }
});
