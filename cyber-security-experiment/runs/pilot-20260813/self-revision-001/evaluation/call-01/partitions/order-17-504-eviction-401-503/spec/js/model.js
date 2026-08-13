const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

// The partition generator replaces null with one of all 24 disruption orders.
bthread("Open coupled-zone attacker", function () {
  let disruptionOrder=["504","EVICTION","401","503"], disruptionIndex=0;
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
 * Deterministic recovery controller.  The local prefixes are only values that
 * have been confirmed by responses; snapA/snapB are the last atomic checkpoint.
 * Nominal path: 11 requests.  The one-shot 503, 504, eviction, and 401 add at
 * most 1, 2, 2, and 4 requests respectively, so every combined path is <= 20.
 */
bp.registerBThread("causal two-zone recovery controller", function () {
  var a = 0, b = 0;
  var aliveA = false, aliveB = false;
  var snapA = -1, snapB = -1; // -1 means no durable checkpoint yet
  var compromised = false;

  while (true) {
    var request;
    var kind = "";
    var zone = "";

    if (compromised) {
      // A 401 makes rotation the only request the contract permits us to use.
      request = "POST /credentials/rotate";
      kind = "rotate";
    } else if ((!aliveA || !aliveB) && snapA >= 0) {
      // Eviction is cheaper and safer to repair by restoring the last checkpoint.
      request = "POST /response-snapshot/restore";
      kind = "restore";
    } else if (!aliveA) {
      request = "POST /mitigation/A";
      kind = "create";
      zone = "A";
    } else if (!aliveB) {
      request = "POST /mitigation/B";
      kind = "create";
      zone = "B";
    } else if (a === 2 && b === 2) {
      // A confirmed stage-2 pair is safe to reopen; no further checkpoint is needed.
      request = "POST /traffic/reopen";
      kind = "reopen";
    } else if (snapA !== a || snapB !== b) {
      // Checkpoint each joint confirmed prefix before exposing another stage.
      request = "POST /response-snapshot";
      kind = "snapshot";
    } else if (a < 2) {
      request = "PUT /mitigation/A/stage/" + (a + 1);
      kind = "stage";
      zone = "A";
    } else if (b < 2) {
      request = "PUT /mitigation/B/stage/" + (b + 1);
      kind = "stage";
      zone = "B";
    }

    bp.sync({request: E(request), block: RESPONSES});
    var observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
    var name = String(observed.name);

    if (name.indexOf("401 ") === 0) {
      // Rotation invalidates ordinary workspaces; the durable snapshot remains.
      compromised = true;
      aliveA = aliveB = false;
      a = b = 0;
      continue;
    }

    if (kind === "rotate") {
      // The only legal rotation success starts a new credential epoch.
      compromised = false;
      if (snapA >= 0) {
        bp.sync({request: E("POST /response-snapshot/restore"), block: RESPONSES});
        observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
        name = String(observed.name);
        if (name.indexOf("401 ") === 0) {
          compromised = true;
        } else if (name.indexOf("201 Restored") === 0) {
          aliveA = aliveB = true;
          a = snapA;
          b = snapB;
        } else { // Legal 409 No snapshot: discard the stale local checkpoint.
          snapA = snapB = -1;
          aliveA = aliveB = false;
          a = b = 0;
        }
      }
      continue;
    }

    if (kind === "create") {
      if (name.indexOf("201 Created") === 0) {
        if (zone === "A") { aliveA = true; a = 0; }
        else { aliveB = true; b = 0; }
      }
      // A legal 503 leaves all remembered state unchanged, so retry next turn.
      continue;
    }

    if (kind === "snapshot") {
      if (name.indexOf("201 Snapshotted") === 0) {
        snapA = a;
        snapB = b;
      } else if (name.indexOf("409 ") === 0) {
        // An invalid-workspace report is recovered from the older snapshot.
        aliveA = aliveB = false;
        a = b = 0;
      }
      continue;
    }

    if (kind === "restore") {
      if (name.indexOf("201 Restored") === 0) {
        aliveA = aliveB = true;
        a = snapA;
        b = snapB;
      } else if (name.indexOf("409 ") === 0) {
        snapA = snapB = -1;
        aliveA = aliveB = false;
        a = b = 0;
      }
      continue;
    }

    if (kind === "stage") {
      if (name.indexOf("204 Applied") === 0) {
        if (zone === "A") { a++; } else { b++; }
      } else if (name.indexOf("504 ") === 0) {
        // Status is mandatory here: its final numeric field is the resolved prefix.
        bp.sync({request: E("GET /mitigation/" + zone + "/status"), block: RESPONSES});
        observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
        name = String(observed.name);
        if (name.indexOf("401 ") === 0) {
          compromised = true;
          aliveA = aliveB = false;
          a = b = 0;
        } else {
          var numbers = name.match(/\d+/g);
          var prefix = numbers ? parseInt(numbers[numbers.length - 1], 10) : -1;
          // Legal status values are 0, 1, or 2; retain only the reported one.
          if (zone === "A") { a = prefix; } else { b = prefix; }
        }
      } else if (name.indexOf("409 ") === 0) {
        // Capacity eviction names its victim; a restore will use snapA/snapB.
        if (name.indexOf("(A)") >= 0) { aliveA = false; a = 0; }
        else { aliveB = false; b = 0; }
      }
      continue;
    }

    // Reopen has only two legal outcomes.  Success terminates all requests.
    if (kind === "reopen") {
      if (name.indexOf("201 Traffic reopened") === 0) { return; }
      // Defensive legal 409 branch: rebuild from the last causal checkpoint.
      aliveA = aliveB = false;
      a = b = 0;
    }
  }
});
