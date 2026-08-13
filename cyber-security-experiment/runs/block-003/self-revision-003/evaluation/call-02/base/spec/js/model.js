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
 * A prefix is trusted only when it has been observed.  snapA/snapB are the
 * last atomically saved pair; that pair survives an eviction and is usable in
 * a later credential epoch.  Checkpointing every advance keeps at most one
 * stage outside the durable checkpoint.
 */
bp.registerBThread("causal-two-zone-recovery", function () {
  var a = -1, b = -1;       // -1: no current workspace; otherwise prefix 0..2
  var snapA = 0, snapB = 0;
  var haveSnapshot = false;
  var checkpointNeeded = false;
  var rotateNeeded = false;
  var restoreNeeded = false;

  function call(path) {
    bp.sync({request: E(path), block: RESPONSES});
    return bp.sync({waitFor: RESPONSES, block: REQUESTS});
  }

  function n(event) {
    return event.name;
  }

  function isCompromise(event) {
    return n(event) === "401 Credential compromised";
  }

  function forgetCurrent() {
    a = -1;
    b = -1;
    checkpointNeeded = false;
  }

  // A status response is the authoritative resolution of a preceding timeout.
  function prefixFromStatus(event) {
    var match = n(event).match(/Prefix\(([012])\)$/);
    return match ? parseInt(match[1], 10) : -1;
  }

  function recordEviction(event) {
    if (n(event).indexOf("(A)") >= 0) a = -1;
    else if (n(event).indexOf("(B)") >= 0) b = -1;
    // The next action is restore, which deliberately replaces both zones.
    restoreNeeded = haveSnapshot;
  }

  while (true) {
    var response, zone, next, prefix;

    // Rotation is the sole unprotected operation.  It invalidates both live
    // workspaces but does not discard the durable response snapshot.
    if (rotateNeeded) {
      response = call("POST /credentials/rotate");
      if (n(response) === "200 Rotated") {
        forgetCurrent();
        rotateNeeded = false;
        restoreNeeded = haveSnapshot;
      }
      continue;
    }

    // Restore is always preferred to recreating one side: it restores the
    // paired checkpoint and avoids retaining newer progress on only one zone.
    if (restoreNeeded) {
      response = call("POST /response-snapshot/restore");
      if (n(response) === "201 Restored") {
        a = snapA;
        b = snapB;
        restoreNeeded = false;
        checkpointNeeded = false;
      } else if (isCompromise(response)) {
        forgetCurrent();
        rotateNeeded = true;
      } else { // 409 No snapshot: do not assume a stale local checkpoint exists.
        haveSnapshot = false;
        restoreNeeded = false;
        forgetCurrent();
      }
      continue;
    }

    // Build missing current-epoch workspaces.  503 changes no workspace state.
    if (a < 0 || b < 0) {
      zone = a < 0 ? "A" : "B";
      response = call("POST /mitigation/" + zone);
      if (n(response) === "201 Created (" + zone + ")") {
        if (zone === "A") a = 0;
        else b = 0;
      } else if (isCompromise(response)) {
        forgetCurrent();
        rotateNeeded = true;
      }
      continue;
    }

    // Before the first stage, and after every confirmed advance, save the
    // complete pair.  With valid current workspaces this must be Snapshotted.
    if (!haveSnapshot || checkpointNeeded) {
      response = call("POST /response-snapshot");
      if (n(response) === "201 Snapshotted") {
        snapA = a;
        snapB = b;
        haveSnapshot = true;
        checkpointNeeded = false;
      } else if (isCompromise(response)) {
        forgetCurrent();
        rotateNeeded = true;
      } else { // Defensive handling of Invalid workspace.
        restoreNeeded = haveSnapshot;
        if (!haveSnapshot) forgetCurrent();
      }
      continue;
    }

    if (a < 2 || b < 2) {
      zone = a < 2 ? "A" : "B";
      next = (zone === "A" ? a : b) + 1;
      response = call("PUT /mitigation/" + zone + "/stage/" + next);

      if (n(response) === "204 Applied") {
        if (zone === "A") a = next;
        else b = next;
        checkpointNeeded = true;
      } else if (n(response) === "504 Edge timeout") {
        // No later stage is selected until status reveals whether it applied.
        response = call("GET /mitigation/" + zone + "/status");
        if (isCompromise(response)) {
          forgetCurrent();
          rotateNeeded = true;
        } else {
          prefix = prefixFromStatus(response);
          if (prefix >= 0) {
            if (zone === "A") a = prefix;
            else b = prefix;
            checkpointNeeded = true;
          } else { // Defensive invalid-workspace branch.
            restoreNeeded = haveSnapshot;
          }
        }
      } else if (isCompromise(response)) {
        forgetCurrent();
        rotateNeeded = true;
      } else if (n(response).indexOf("409 Capacity eviction") === 0) {
        recordEviction(response);
      } else { // Defensive Invalid workspace response to a stage.
        restoreNeeded = haveSnapshot;
        if (!haveSnapshot) forgetCurrent();
      }
      continue;
    }

    response = call("POST /traffic/reopen");
    if (n(response) === "201 Traffic reopened") return;
    if (isCompromise(response)) {
      forgetCurrent();
      rotateNeeded = true;
    } else { // Unsafe reopen contradicts trusted state; recover conservatively.
      restoreNeeded = haveSnapshot;
      if (!haveSnapshot) forgetCurrent();
    }
  }
});
