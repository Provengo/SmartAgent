/* A deterministic, response-driven controller for the coupled recovery. */
bp.registerBThread("atomic-two-zone-recovery", function () {
  // Confirmed live prefixes and the most recently acknowledged atomic snapshot.
  var a = 0, b = 0, savedA = 0, savedB = 0;
  var reopened = false;

  function request(name) {
    bp.sync({request: E(name), block: RESPONSES});
    return bp.sync({waitFor: RESPONSES, block: REQUESTS});
  }

  function responseName(event) {
    return String(event.name);
  }

  function starts(event, text) {
    return responseName(event).indexOf(text) === 0;
  }

  function setLive(zone, prefix) {
    if (zone === "A") { a = prefix; } else { b = prefix; }
  }

  function reportedPrefix(event) {
    // Status event spellings may include punctuation; its final prefix digit is decisive.
    var digits = responseName(event).match(/[012]/g);
    return digits ? Number(digits[digits.length - 1]) : -1;
  }

  function restore() {
    var reply = request("POST /response-snapshot/restore");
    if (starts(reply, "201 Restored")) {
      a = savedA;
      b = savedB;
    }
    // A 409 can only mean no prior snapshot.  The initial snapshot below is
    // acknowledged before stages begin, so that branch is unreachable thereafter.
  }

  function rotateAndRestore() {
    // Rotation is the sole request allowed during credential compromise.
    var reply = request("POST /credentials/rotate");
    if (starts(reply, "200 Rotated")) {
      restore();
    }
  }

  function snapshot() {
    var reply = request("POST /response-snapshot");
    if (starts(reply, "201 Snapshotted")) {
      savedA = a;
      savedB = b;
      return;
    }
    if (starts(reply, "401 ")) {
      rotateAndRestore();
    } else if (starts(reply, "409 ")) {
      restore();
    }
  }

  function create(zone) {
    var reply;
    do {
      reply = request("POST /mitigation/" + zone);
      // The globally single flood response leaves this workspace absent.
    } while (!starts(reply, "201 Created"));
  }

  function applyNext(zone, wanted) {
    var reply = request("PUT /mitigation/" + zone + "/stage/" + wanted);

    if (starts(reply, "204 Applied")) {
      setLive(zone, wanted);
      snapshot();
    } else if (starts(reply, "504 ")) {
      // This immediate observation is required before the timed-out stage is counted.
      var status = request("GET /mitigation/" + zone + "/status");
      if (reportedPrefix(status) === wanted) {
        setLive(zone, wanted);
        snapshot();
      }
      // A prior-prefix report leaves local state unchanged, so the stage is retried.
    } else if (starts(reply, "401 ")) {
      rotateAndRestore();
    } else if (starts(reply, "409 ")) {
      // The victim is attacker-selected; restore both zones, not just the request zone.
      restore();
    }
  }

  create("A");
  create("B");
  snapshot();                         // Establishes the durable (0,0) base.

  while (!reopened) {
    var zone = a < 2 ? "A" : "B";
    var wanted = zone === "A" ? a + 1 : b + 1;
    applyNext(zone, wanted);

    if (a === 2 && b === 2) {
      var reply = request("POST /traffic/reopen");
      if (starts(reply, "201 Traffic reopened")) {
        reopened = true;               // Make no request after the only success event.
      } else if (starts(reply, "401 ")) {
        rotateAndRestore();
      } else if (starts(reply, "409 ")) {
        restore();
      }
    }
  }

  /* Baseline: 2 creates + 5 snapshots + 4 stages + reopen = 12 requests.
     The one flood costs 1; a non-applied timeout costs status plus retry = 2;
     expiry costs rotate, restore, and retry = 3; eviction costs restore and
     retry = 2.  Thus every combined legal branch completes within 20. */
});
