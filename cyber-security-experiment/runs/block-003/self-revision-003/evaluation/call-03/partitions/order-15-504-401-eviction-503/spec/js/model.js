const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

// The partition generator replaces null with one of all 24 disruption orders.
bthread("Open coupled-zone attacker", function () {
  let disruptionOrder=["504","401","EVICTION","503"], disruptionIndex=0;
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
 * a and b are confirmed prefixes in the live credential epoch; -1 means that
 * the workspace is not known to exist.  The snapshot is a durable, paired
 * checkpoint and may be restored into a later epoch.
 *
 * A checkpoint is taken before every stage.  Thus each disruptive stage
 * outcome can be recovered without losing any previously confirmed stage.
 * Normal completion takes 12 requests.  The one-off 503, 504, eviction, and
 * credential compromise add at most 1, 1, 2, and 3 requests respectively,
 * for a worst case of 19 (including reopen).
 */
bp.registerBThread("causal-two-zone-recovery", function () {
  var a = -1, b = -1;
  var snapA = 0, snapB = 0, haveSnapshot = false;
  var checkpointNeeded = false;
  var rotateNeeded = false, restoreNeeded = false;

  function call(requestName) {
    bp.sync({request: E(requestName), block: RESPONSES});
    return bp.sync({waitFor: RESPONSES, block: REQUESTS});
  }

  // BPjs event names can be Java strings, so normalize before comparing.
  function nameOf(event) {
    return String(event.name);
  }

  function compromised(response) {
    return nameOf(response) === "401 Credential compromised";
  }

  function forgetLive() {
    a = -1;
    b = -1;
    checkpointNeeded = false;
  }

  // Status is requested only immediately after a timeout.  Its final digit is
  // the authoritative prefix (the contract limits prefixes to 0, 1, and 2).
  function statusPrefix(response) {
    var s = nameOf(response);
    var i = s.lastIndexOf("Prefix(");
    if (i < 0 || s.charAt(s.length - 1) !== ")") return -1;
    var digit = s.charAt(s.length - 2);
    return digit === "0" ? 0 : (digit === "1" ? 1 : (digit === "2" ? 2 : -1));
  }

  function setPrefix(zone, value) {
    if (zone === "A") a = value;
    else b = value;
  }

  function prefixOf(zone) {
    return zone === "A" ? a : b;
  }

  while (true) {
    var response, responseName, zone, next, before, resolved;

    // Rotation is the only request allowed while credentials are compromised.
    if (rotateNeeded) {
      response = call("POST /credentials/rotate");
      if (nameOf(response) === "200 Rotated") {
        forgetLive();
        rotateNeeded = false;
        restoreNeeded = haveSnapshot;
      }
      continue;
    }

    // Restoring deliberately replaces both zones, including any newer prefix
    // on the zone which was not evicted.
    if (restoreNeeded) {
      response = call("POST /response-snapshot/restore");
      responseName = nameOf(response);
      if (responseName === "201 Restored") {
        a = snapA;
        b = snapB;
        checkpointNeeded = false;
        restoreNeeded = false;
      } else if (compromised(response)) {
        forgetLive();
        rotateNeeded = true;
      } else { // 409 No snapshot: local checkpoint can no longer be trusted.
        haveSnapshot = false;
        restoreNeeded = false;
        forgetLive();
      }
      continue;
    }

    // A 503 leaves all known workspace state unchanged; retry creation.
    if (a < 0 || b < 0) {
      zone = a < 0 ? "A" : "B";
      response = call("POST /mitigation/" + zone);
      responseName = nameOf(response);
      if (responseName === "201 Created (" + zone + ")") setPrefix(zone, 0);
      else if (compromised(response)) {
        forgetLive();
        rotateNeeded = true;
      }
      continue;
    }

    // Save the complete current pair before the next potentially disruptive
    // stage request, and after a timeout which was observed to apply.
    if (!haveSnapshot || checkpointNeeded) {
      response = call("POST /response-snapshot");
      responseName = nameOf(response);
      if (responseName === "201 Snapshotted") {
        snapA = a;
        snapB = b;
        haveSnapshot = true;
        checkpointNeeded = false;
      } else if (compromised(response)) {
        forgetLive();
        rotateNeeded = true;
      } else { // 409 Invalid workspace
        if (haveSnapshot) restoreNeeded = true;
        else forgetLive();
      }
      continue;
    }

    if (a < 2 || b < 2) {
      zone = a < 2 ? "A" : "B";
      before = prefixOf(zone);
      next = before + 1;
      response = call("PUT /mitigation/" + zone + "/stage/" + next);
      responseName = nameOf(response);

      if (responseName === "204 Applied") {
        setPrefix(zone, next);
        checkpointNeeded = true;
      } else if (responseName === "504 Edge timeout") {
        // Never infer the outcome of an ambiguous stage; observe it first.
        response = call("GET /mitigation/" + zone + "/status");
        if (compromised(response)) {
          forgetLive();
          rotateNeeded = true;
        } else {
          resolved = statusPrefix(response);
          if (resolved >= 0) {
            setPrefix(zone, resolved);
            // If it did not apply, the existing checkpoint remains exact.
            checkpointNeeded = resolved !== before;
          } else if (haveSnapshot) {
            restoreNeeded = true;
          } else {
            forgetLive();
          }
        }
      } else if (compromised(response)) {
        forgetLive();
        rotateNeeded = true;
      } else if (responseName.indexOf("409 Capacity eviction(A)") === 0) {
        a = -1;
        restoreNeeded = haveSnapshot;
      } else if (responseName.indexOf("409 Capacity eviction(B)") === 0) {
        b = -1;
        restoreNeeded = haveSnapshot;
      } else { // 409 Invalid workspace (defensive, though unreachable here)
        if (haveSnapshot) restoreNeeded = true;
        else forgetLive();
      }
      continue;
    }

    response = call("POST /traffic/reopen");
    responseName = nameOf(response);
    if (responseName === "201 Traffic reopened") return;
    if (compromised(response)) {
      forgetLive();
      rotateNeeded = true;
    } else if (haveSnapshot) { // 409 Unsafe to reopen: recover conservatively.
      restoreNeeded = true;
    } else {
      forgetLive();
    }
  }
});
