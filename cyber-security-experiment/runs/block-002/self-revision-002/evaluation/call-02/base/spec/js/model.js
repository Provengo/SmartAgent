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
