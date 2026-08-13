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
