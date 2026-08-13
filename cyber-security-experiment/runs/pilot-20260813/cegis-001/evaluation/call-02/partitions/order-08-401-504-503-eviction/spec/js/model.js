const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

// The partition generator replaces null with one of all 24 disruption orders.
bthread("Open coupled-zone attacker", function () {
  let disruptionOrder=["401","504","503","EVICTION"], disruptionIndex=0;
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
    } else if (prefixA === 2 && prefixB === 2) {
      request = "POST /traffic/reopen";
      kind = "reopen";
    } else if (!haveSnapshot || snapshotDirty) {
      // Persist every confirmed prefix before another stage can be disrupted.
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
      snapshotDirty = !haveSnapshot || prefixA !== snapshotA || prefixB !== snapshotB;
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
