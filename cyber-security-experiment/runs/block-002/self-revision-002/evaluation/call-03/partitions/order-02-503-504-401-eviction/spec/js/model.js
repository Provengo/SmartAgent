const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

// The partition generator replaces null with one of all 24 disruption orders.
bthread("Open coupled-zone attacker", function () {
  let disruptionOrder=["503","504","401","EVICTION"], disruptionIndex=0;
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

/* Deterministic controller for atomic two-zone recovery. */
bp.registerBThread("atomic-two-zone-recovery", function () {
  // These are only confirmed prefixes.  saved* is an acknowledged atomic snapshot.
  var a = 0;
  var b = 0;
  var savedA = 0;
  var savedB = 0;
  var haveSnapshot = false;
  var reopened = false;

  function ask(name) {
    bp.sync({request: E(name), block: RESPONSES});
    return bp.sync({waitFor: RESPONSES, block: REQUESTS});
  }

  function nameOf(event) {
    return String(event.name);
  }

  function is(event, prefix) {
    return nameOf(event).indexOf(prefix) === 0;
  }

  function prefixFromStatus(event) {
    // Contract status events end in Prefix(0), Prefix(1), or Prefix(2).
    var text = nameOf(event);
    return Number(text.charAt(text.length - 2));
  }

  function rotate() {
    // Rotation is the only request permitted while credentials are compromised.
    ask("POST /credentials/rotate");
  }

  function restoreSnapshot() {
    var reply = ask("POST /response-snapshot/restore");
    if (is(reply, "201 Restored")) {
      a = savedA;
      b = savedB;
      return true;
    }
    // With haveSnapshot true, 409 is not a legal causal outcome.  A 401 can
    // only be followed by rotation; retain no unconfirmed live-prefix claim.
    if (is(reply, "401 ")) {
      rotate();
    }
    return false;
  }

  function recoverAfterExpiry() {
    rotate();
    // All ordinary workspaces were invalidated by the shared epoch advance.
    if (haveSnapshot) {
      restoreSnapshot();
    }
  }

  function create(zone) {
    var reply;
    while (true) {
      reply = ask("POST /mitigation/" + zone);
      if (is(reply, "201 Created")) {
        return true;
      }
      if (is(reply, "401 ")) {
        return false;
      }
      // The sole 503 leaves the requested workspace absent, so retry it.
    }
  }

  function establishInitialSnapshot() {
    // This loop also safely handles an expiry encountered before any snapshot:
    // rotation invalidates a possibly-created first workspace, so build both again.
    while (!haveSnapshot) {
      if (!create("A")) {
        rotate();
        continue;
      }
      if (!create("B")) {
        rotate();
        continue;
      }
      var reply = ask("POST /response-snapshot");
      if (is(reply, "201 Snapshotted")) {
        savedA = 0;
        savedB = 0;
        a = 0;
        b = 0;
        haveSnapshot = true;
      } else if (is(reply, "401 ")) {
        rotate();
      }
      // A 409 means the server did not accept a valid pair; rebuild rather
      // than treating either local workspace as usable.
    }
  }

  function checkpoint() {
    var reply = ask("POST /response-snapshot");
    if (is(reply, "201 Snapshotted")) {
      savedA = a;
      savedB = b;
    } else if (is(reply, "401 ")) {
      recoverAfterExpiry();
    } else if (is(reply, "409 ")) {
      // A capacity eviction cannot occur on snapshot, but never advance based
      // on a rejected checkpoint; restore the last known atomic state.
      restoreSnapshot();
    }
  }

  function apply(zone, wanted) {
    var reply = ask("PUT /mitigation/" + zone + "/stage/" + wanted);
    if (is(reply, "204 Applied")) {
      if (zone === "A") { a = wanted; } else { b = wanted; }
      checkpoint();
    } else if (is(reply, "504 ")) {
      // A timeout is ambiguous until this required immediate status observation.
      var status = ask("GET /mitigation/" + zone + "/status");
      if (is(status, "401 ")) {
        recoverAfterExpiry();
      } else if (prefixFromStatus(status) === wanted) {
        if (zone === "A") { a = wanted; } else { b = wanted; }
        checkpoint();
      }
      // The prior prefix means no local update and the main loop retries it.
    } else if (is(reply, "401 ")) {
      recoverAfterExpiry();
    } else if (is(reply, "409 ")) {
      // The response identifies a victim, but the snapshot reconstructs both.
      restoreSnapshot();
    }
  }

  establishInitialSnapshot();

  while (!reopened) {
    var zone = a < 2 ? "A" : "B";
    var wanted = zone === "A" ? a + 1 : b + 1;
    apply(zone, wanted);

    if (a === 2 && b === 2) {
      var reply = ask("POST /traffic/reopen");
      if (is(reply, "201 Traffic reopened")) {
        reopened = true;
      } else if (is(reply, "401 ")) {
        recoverAfterExpiry();
      } else if (is(reply, "409 ")) {
        restoreSnapshot();
      }
    }
  }

  /* Normal path: 2 creates + initial snapshot + 4 (stage,snapshot) + reopen = 12.
     The single 503 adds 1; a non-applied timeout adds status and retry (2);
     eviction adds restore and retry/checkpoint (2); expiry adds rotate, restore,
     and retry/checkpoint (3).  Total worst case: 20 requests. */
});
