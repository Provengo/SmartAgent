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

/* Deterministic controller: -1 means no trusted workspace; 0..2 is its
 * confirmed applied-stage prefix.  A compromise invalidates both prefixes. */
bp.registerBThread("causal-two-zone-recovery", function () {
  var a = -1;
  var b = -1;
  var rotateNeeded = false;

  // A request is always followed by one response before this controller acts again.
  function call(path) {
    bp.sync({request: E(path), block: RESPONSES});
    return bp.sync({waitFor: RESPONSES, block: REQUESTS});
  }

  function nameOf(event) {
    return event.name;
  }

  function compromised(event) {
    return nameOf(event) === "401 Credential compromised";
  }

  // Status replies end in the zone's confirmed prefix (0, 1, or 2).
  function reportedPrefix(event) {
    var m = nameOf(event).match(/([012])$/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // Capacity eviction names exactly one victim; only that prefix is forgotten.
  function recordEviction(event) {
    if (nameOf(event).indexOf("(A)") >= 0 || nameOf(event).indexOf(" A") >= 0) {
      a = -1;
    } else {
      b = -1;
    }
  }

  while (true) {
    var response;

    if (rotateNeeded) {
      response = call("POST /credentials/rotate");
      // A successful rotation starts a new shared epoch, so rebuild from zero.
      if (nameOf(response) === "200 Rotated") {
        a = -1;
        b = -1;
        rotateNeeded = false;
      }
      continue;
    }

    if (a < 0 || b < 0) {
      var zone = a < 0 ? "A" : "B";
      response = call("POST /mitigation/" + zone);
      if (compromised(response)) {
        rotateNeeded = true;
      } else if (nameOf(response).indexOf("201 Created") === 0) {
        if (zone === "A") a = 0;
        else b = 0;
      }
      // 503 is deliberately retried; it has not changed remembered state.
      continue;
    }

    if (a < 2 || b < 2) {
      // Finish A first, then B; both workspaces are known to exist here.
      var stageZone = a < 2 ? "A" : "B";
      var oldPrefix = stageZone === "A" ? a : b;
      var nextStage = oldPrefix + 1;
      response = call("PUT /mitigation/" + stageZone + "/stage/" + nextStage);

      if (compromised(response)) {
        rotateNeeded = true;
      } else if (nameOf(response) === "204 Applied") {
        if (stageZone === "A") a = nextStage;
        else b = nextStage;
      } else if (nameOf(response).indexOf("504 Edge timeout") === 0) {
        // Resolve the one ambiguous stage before counting it or issuing work.
        response = call("GET /mitigation/" + stageZone + "/status");
        if (compromised(response)) {
          rotateNeeded = true;
        } else if (stageZone === "A") {
          a = reportedPrefix(response);
        } else {
          b = reportedPrefix(response);
        }
      } else if (nameOf(response).indexOf("409 Capacity eviction") === 0) {
        recordEviction(response);
      }
      continue;
    }

    response = call("POST /traffic/reopen");
    if (nameOf(response) === "201 Traffic reopened") {
      return; // Terminal success: make no further requests.
    }
    if (compromised(response)) {
      rotateNeeded = true;
    } else {
      // Defensive branch for Unsafe to reopen: no longer rely on either prefix.
      a = -1;
      b = -1;
    }
  }
});
