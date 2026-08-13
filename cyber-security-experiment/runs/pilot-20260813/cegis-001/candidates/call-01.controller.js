bp.registerBThread("deterministic-c2-incident-controller", function () {
  // Confirmed prefixes and workspace validity for the current credential epoch.
  var prefixA = 0, prefixB = 0;
  var validA = false, validB = false;

  // The last atomic checkpoint is the only state used after a disruptive reply.
  var haveSnapshot = false, snapshotA = 0, snapshotB = 0, snapshotDirty = false;
  var compromised = false, restoreNeeded = false, statusNeeded = null;

  while (true) {
    var request;
    var kind;
    var zone;
    var stage;

    // A 401 changes the epoch, so rotation is the sole permitted next action.
    if (compromised) {
      request = "POST /credentials/rotate";
      kind = "rotate";
    } else if (statusNeeded !== null) {
      // A timeout is resolved by the immediately following status observation.
      zone = statusNeeded;
      request = "GET /mitigation/" + zone + "/status";
      kind = "status";
    } else if (restoreNeeded && haveSnapshot) {
      request = "POST /response-snapshot/restore";
      kind = "restore";
    } else if (!validA) {
      request = "POST /mitigation/A";
      kind = "create";
      zone = "A";
    } else if (!validB) {
      request = "POST /mitigation/B";
      kind = "create";
      zone = "B";
    } else if (!haveSnapshot || (snapshotDirty && prefixA === 1 && prefixB === 1)) {
      // Checkpoint 0/0 and 1/1; the final two-stage batch is replayable from 1/1.
      request = "POST /response-snapshot";
      kind = "snapshot";
    } else if (prefixA < 2) {
      zone = "A";
      stage = prefixA + 1;
      request = "PUT /mitigation/A/stage/" + stage;
      kind = "stage";
    } else if (prefixB < 2) {
      zone = "B";
      stage = prefixB + 1;
      request = "PUT /mitigation/B/stage/" + stage;
      kind = "stage";
    } else {
      request = "POST /traffic/reopen";
      kind = "reopen";
    }

    bp.sync({request: E(request), block: RESPONSES});
    var observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
    var reply = observed.name;

    // This success is terminal: make no further requests.
    if (kind === "reopen" && reply === "201 Traffic reopened") {
      break;
    }

    // Credential compromise overrides the normal meaning of the failed request.
    if (reply.indexOf("401 ") === 0) {
      compromised = true;
      statusNeeded = null;
      continue;
    }

    if (kind === "rotate") {
      // Rotation invalidates ordinary workspaces; a durable snapshot survives it.
      compromised = false;
      validA = false;
      validB = false;
      prefixA = 0;
      prefixB = 0;
      restoreNeeded = haveSnapshot;
      continue;
    }

    if (kind === "restore") {
      if (reply.indexOf("201 ") === 0) {
        prefixA = snapshotA;
        prefixB = snapshotB;
        validA = true;
        validB = true;
        snapshotDirty = false;
        restoreNeeded = false;
      } else { // 409 No snapshot: rebuild a known pair from zero.
        haveSnapshot = false;
        restoreNeeded = false;
        validA = false;
        validB = false;
        prefixA = 0;
        prefixB = 0;
      }
      continue;
    }

    if (kind === "status") {
      // Status names end in the reported confirmed prefix (0, 1, or 2).
      var suffix = reply.match(/(\d+)\D*$/);
      var reportedPrefix = suffix ? Number(suffix[1]) : 0;
      if (zone === "A") {
        prefixA = reportedPrefix;
        validA = true;
      } else {
        prefixB = reportedPrefix;
        validB = true;
      }
      snapshotDirty = true;
      statusNeeded = null;
      continue;
    }

    if (kind === "create") {
      if (reply.indexOf("201 ") === 0) {
        if (zone === "A") {
          validA = true;
          prefixA = 0;
        } else {
          validB = true;
          prefixB = 0;
        }
        snapshotDirty = true;
      }
      // 503 leaves this zone invalid, so the deterministic next choice retries it.
      continue;
    }

    if (kind === "snapshot") {
      if (reply.indexOf("201 ") === 0) {
        snapshotA = prefixA;
        snapshotB = prefixB;
        haveSnapshot = true;
        snapshotDirty = false;
      } else { // 409 Invalid workspace: recover the last durable pair if present.
        if (haveSnapshot) {
          restoreNeeded = true;
        } else {
          validA = false;
          validB = false;
        }
      }
      continue;
    }

    if (kind === "stage") {
      if (reply.indexOf("204 ") === 0) {
        if (zone === "A") {
          prefixA = stage;
        } else {
          prefixB = stage;
        }
        snapshotDirty = true;
      } else if (reply.indexOf("504 ") === 0) {
        // Do not count an ambiguous stage until status resolves its outcome.
        statusNeeded = zone;
      } else { // 409 Capacity eviction(victim): snapshot recovery handles either victim.
        if (haveSnapshot) {
          restoreNeeded = true;
        } else {
          validA = false;
          validB = false;
        }
      }
      continue;
    }

    // A 409 Unsafe to reopen is unreachable from confirmed state; recover safely.
    if (kind === "reopen") {
      if (haveSnapshot) {
        restoreNeeded = true;
      } else {
        validA = false;
        validB = false;
      }
    }
  }
});
