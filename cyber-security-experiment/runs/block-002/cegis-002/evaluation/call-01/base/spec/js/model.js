const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

// The partition generator replaces null with one of all 24 disruption orders.
bthread("Open coupled-zone attacker", function () {
  let disruptionOrder=null, disruptionIndex=0;
  let outageUsed=false, expiryUsed=false, expired=false, timeoutUsed=false, evictionUsed=false;
  let epoch=0, validA=false, validB=false, epochA=-1, epochB=-1, pA=0, pB=0;
  let hasSnapshot=false, snapA=0, snapB=0, ambiguousTarget="";
  let requestEvent,responseEvent,target="",legal,prefix;
  while (true) {
    requestEvent=waitFor(REQUESTS);
    if (requestEvent.name.equals("POST /mitigation/A") || requestEvent.name.equals("POST /mitigation/B")) {
      target=requestEvent.name.equals("POST /mitigation/A") ? "A" : "B";
      if (expired) bp.sync({request:E("401 Credential compromised")});
      else {
        responseEvent=bp.sync({request:(outageUsed || (disruptionOrder!==null && disruptionOrder[disruptionIndex]!=="503")) ?
          E("201 Created ("+target+")") : [E("201 Created ("+target+")"),E("503 Control-plane flood")]});
        if (responseEvent.name.equals("503 Control-plane flood")) { outageUsed=true; if(disruptionOrder!==null) disruptionIndex++; }
        else if (target==="A") { validA=true; epochA=epoch; pA=0; }
        else { validB=true; epochB=epoch; pB=0; }
      }
    } else if (requestEvent.name.indexOf("PUT /mitigation/")===0) {
      target=requestEvent.name.indexOf("/A/")>0 ? "A" : "B";
      if (expired) bp.sync({request:E("401 Credential compromised")});
      else if ((target==="A" && !validA) || (target==="B" && !validB)) bp.sync({request:E("409 Invalid workspace")});
      else {
        legal=[E("204 Applied")];
        if (!expiryUsed && (disruptionOrder===null || disruptionOrder[disruptionIndex]==="401")) legal.push(E("401 Credential compromised"));
        if (!timeoutUsed && (disruptionOrder===null || disruptionOrder[disruptionIndex]==="504")) legal.push(E("504 Edge timeout"));
        if (!evictionUsed && validA && (disruptionOrder===null || disruptionOrder[disruptionIndex]==="EVICTION")) legal.push(E("409 Capacity eviction(A)"));
        if (!evictionUsed && validB && (disruptionOrder===null || disruptionOrder[disruptionIndex]==="EVICTION")) legal.push(E("409 Capacity eviction(B)"));
        responseEvent=bp.sync({request:legal});
        if (responseEvent.name.equals("401 Credential compromised")) { expiryUsed=true; expired=true; if(disruptionOrder!==null) disruptionIndex++; }
        else if (responseEvent.name.equals("504 Edge timeout")) { timeoutUsed=true; ambiguousTarget=target; if(disruptionOrder!==null) disruptionIndex++; }
        else if (responseEvent.name.equals("409 Capacity eviction(A)")) { evictionUsed=true; validA=false; if(disruptionOrder!==null) disruptionIndex++; }
        else if (responseEvent.name.equals("409 Capacity eviction(B)")) { evictionUsed=true; validB=false; if(disruptionOrder!==null) disruptionIndex++; }
        else if (target==="A") pA++; else pB++;
      }
    } else if (requestEvent.name.indexOf("GET /mitigation/")===0) {
      target=requestEvent.name.indexOf("/A/")>0 ? "A" : "B";
      if (expired) bp.sync({request:E("401 Credential compromised")});
      else if (ambiguousTarget===target) {
        prefix=target==="A" ? pA : pB;
        responseEvent=bp.sync({request:[E("200 "+target+" Prefix("+prefix+")"),E("200 "+target+" Prefix("+(prefix+1)+")")]});
        if (responseEvent.name.equals("200 "+target+" Prefix("+(prefix+1)+")")) { if(target==="A") pA++; else pB++; }
        ambiguousTarget="";
      } else bp.sync({request:E("200 "+target+" Prefix("+(target==="A"?pA:pB)+")")});
    } else if (requestEvent.name.equals("POST /credentials/rotate")) {
      bp.sync({request:E("200 Rotated")}); epoch++; expired=false; validA=false; validB=false;
    } else if (requestEvent.name.equals("POST /response-snapshot")) {
      if (expired) bp.sync({request:E("401 Credential compromised")});
      else if (validA && validB && epochA===epoch && epochB===epoch) {
        bp.sync({request:E("201 Snapshotted")}); hasSnapshot=true; snapA=pA; snapB=pB;
      } else bp.sync({request:E("409 Invalid workspace")});
    } else if (requestEvent.name.equals("POST /response-snapshot/restore")) {
      if (expired) bp.sync({request:E("401 Credential compromised")});
      else if (hasSnapshot) {
        bp.sync({request:E("201 Restored")}); validA=true; validB=true; epochA=epoch; epochB=epoch; pA=snapA; pB=snapB;
      } else bp.sync({request:E("409 No snapshot")});
    } else if (requestEvent.name.equals("POST /traffic/reopen")) {
      let valid=validA&&validB&&epochA===epoch&&epochB===epoch&&pA===2&&pB===2&&!expired;
      bp.sync({request:E(valid?"201 Traffic reopened":"409 Unsafe to reopen")});
      if(valid) break;
    } else {
      bp.ASSERT(false,"ILLEGAL_REQUEST: "+requestEvent.name);
    }
  }
});

bthread("C2 bounded-success monitor", function () {
  let count=0,responseEvent;
  while(true){
    waitFor(REQUESTS); count++;
    bp.ASSERT(count<=20,"BOUNDED_REACHABILITY_FAILURE: more than 20 requests");
    responseEvent=waitFor(RESPONSES);
    if(responseEvent.name.equals("201 Traffic reopened")) break;
  }
});

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
