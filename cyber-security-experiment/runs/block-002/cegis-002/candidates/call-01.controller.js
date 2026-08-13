/*
 * Confirmed local view only: valid[z] and prefix[z] describe the workspace
 * known to exist in the current credential epoch.  snap records the last
 * atomically confirmed pair, and is retained across credential epochs.
 *
 * Checkpoint after every changed pair.  Thus eviction costs restore + reissue,
 * and a late 401 costs rotate + restore + reopen.  Even with one 503, 504,
 * eviction, and 401, this is at most 20 requests (the contract limit).
 */
bp.registerBThread("deterministic-causal-recovery", function () {
  var prefix = { A: 0, B: 0 };
  var valid = { A: false, B: false };
  var snap = { exists: false, A: 0, B: 0 };
  var compromised = false;
  var pendingStatus = null;
  var restoreNeeded = false;

  function request(name) {
    return bp.sync({ request: E(name), block: RESPONSES });
  }

  function observe() {
    return bp.sync({ waitFor: RESPONSES, block: REQUESTS });
  }

  function responseName(event) {
    return String(event.name);
  }

  // Status names carry the reported confirmed prefix; take their final 0/1/2.
  function reportedPrefix(name) {
    var matches = name.match(/[012]/g);
    return matches ? Number(matches[matches.length - 1]) : 0;
  }

  function evictionVictim(name) {
    if (/\bA\b/.test(name)) return "A";
    if (/\bB\b/.test(name)) return "B";
    return null;
  }

  while (true) {
    var action;
    var kind;
    var zone;
    var stage;

    // A timeout is resolved before any new mutation, so it becomes causal state.
    if (pendingStatus !== null) {
      zone = pendingStatus;
      action = "GET /mitigation/" + zone + "/status";
      kind = "status";
    } else if (compromised) {
      action = "POST /credentials/rotate";
      kind = "rotate";
    } else if (restoreNeeded) {
      action = "POST /response-snapshot/restore";
      kind = "restore";
    } else if (!valid.A) {
      zone = "A";
      action = "POST /mitigation/A";
      kind = "create";
    } else if (!valid.B) {
      zone = "B";
      action = "POST /mitigation/B";
      kind = "create";
    } else if (!snap.exists || snap.A !== prefix.A || snap.B !== prefix.B) {
      // A durable checkpoint is made only from both known-current workspaces.
      action = "POST /response-snapshot";
      kind = "snapshot";
    } else if (prefix.A < 2) {
      zone = "A";
      stage = prefix.A + 1;
      action = "PUT /mitigation/A/stage/" + stage;
      kind = "stage";
    } else if (prefix.B < 2) {
      zone = "B";
      stage = prefix.B + 1;
      action = "PUT /mitigation/B/stage/" + stage;
      kind = "stage";
    } else {
      action = "POST /traffic/reopen";
      kind = "reopen";
    }

    request(action);
    var name = responseName(observe());

    if (/^401\b/.test(name)) {
      // The epoch is unusable until rotation; do not trust either workspace.
      compromised = true;
      pendingStatus = null;
      restoreNeeded = false;
      continue;
    }

    if (kind === "rotate") {
      // A successful rotation invalidates every ordinary workspace atomically.
      compromised = false;
      valid.A = valid.B = false;
      prefix.A = prefix.B = 0;
      restoreNeeded = snap.exists;
    } else if (kind === "restore") {
      if (/^201\b/.test(name)) {
        valid.A = valid.B = true;
        prefix.A = snap.A;
        prefix.B = snap.B;
        restoreNeeded = false;
      } else {
        // A missing checkpoint is safe only by rebuilding both zones locally.
        snap.exists = false;
        restoreNeeded = false;
        valid.A = valid.B = false;
        prefix.A = prefix.B = 0;
      }
    } else if (kind === "create") {
      if (/^201\b/.test(name)) {
        valid[zone] = true;
        prefix[zone] = 0;
      }
      // 503 leaves the zone absent, so the next turn deterministically retries.
    } else if (kind === "stage") {
      if (/^204\b/.test(name)) {
        prefix[zone] = stage;
      } else if (/^504\b/.test(name)) {
        // Do not count an ambiguous application until its mandatory status read.
        pendingStatus = zone;
      } else if (/^409\b/.test(name)) {
        // Eviction applies no requested stage and names the only invalid workspace.
        var victim = evictionVictim(name);
        if (victim !== null) {
          valid[victim] = false;
          prefix[victim] = 0;
          // The snapshot is the exact pre-stage pair, so restore avoids drift.
          restoreNeeded = snap.exists;
        }
      }
    } else if (kind === "status") {
      prefix[zone] = reportedPrefix(name);
      valid[zone] = true;
      pendingStatus = null;
    } else if (kind === "snapshot") {
      if (/^201\b/.test(name)) {
        snap.exists = true;
        snap.A = prefix.A;
        snap.B = prefix.B;
      }
    } else if (kind === "reopen") {
      if (/^201\s+Traffic reopened\b/.test(name)) return;
      // Defensive total branch for an unsafe reopen: rebuild from observations.
      valid.A = valid.B = false;
      prefix.A = prefix.B = 0;
    }
  }
});
