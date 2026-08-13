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
 * Causal recovery controller.  Prefixes are only advanced from an observed
 * 204 (or the status read which resolves a 504); snapA/snapB are the last
 * durable, jointly confirmed checkpoint.
 */
bp.registerBThread("causal-two-zone-recovery", function () {
    var a = 0, b = 0;
    var snapA = 0, snapB = 0, haveSnapshot = false;
    var validA = false, validB = false;
    var dirty = false; // true exactly when current confirmed prefixes need a checkpoint

    function nameOf(e) {
        return e.name;
    }

    // One request is always followed by exactly one observed response.
    function call(requestName) {
        bp.sync({request: E(requestName), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }

    function statusPrefix(response) {
        var text = nameOf(response);
        var match = /prefix\D*([012])\b/i.exec(text);
        if (!match) {
            // Status response names end in the reported prefix in this contract.
            match = /([012])\D*$/.exec(text);
        }
        return match ? Number(match[1]) : 0;
    }

    function restoreCheckpoint() {
        if (!haveSnapshot) {
            validA = false;
            validB = false;
            return;
        }
        var response = call("POST /response-snapshot/restore");
        if (nameOf(response) === "201 Restored") {
            a = snapA;
            b = snapB;
            validA = true;
            validB = true;
            dirty = false;
        } else if (nameOf(response) === "401 Credential compromised") {
            recoverCredentials();
        } else { // 409 No snapshot: discard an unusable remembered checkpoint.
            haveSnapshot = false;
            validA = false;
            validB = false;
        }
    }

    function recoverCredentials() {
        // Rotation advances the epoch, so no ordinary workspace remains valid.
        call("POST /credentials/rotate");
        validA = false;
        validB = false;
        dirty = false;
        // A durable snapshot can be restored into the newly rotated epoch.
        restoreCheckpoint();
    }

    function applyStage(zone, stage) {
        var response = call("PUT /mitigation/" + zone + "/stage/" + stage);
        var responseName = nameOf(response);
        if (responseName === "204 Applied") {
            if (zone === "A") a = stage; else b = stage;
            dirty = true;
        } else if (responseName === "401 Credential compromised") {
            recoverCredentials();
        } else if (responseName === "504 Edge timeout") {
            // The immediately following status observation decides whether it applied.
            var status = call("GET /mitigation/" + zone + "/status");
            if (nameOf(status) === "401 Credential compromised") {
                recoverCredentials();
            } else {
                if (zone === "A") a = statusPrefix(status); else b = statusPrefix(status);
                dirty = (a !== snapA || b !== snapB);
            }
        } else { // 409 Capacity eviction(victim): restore both zones atomically.
            restoreCheckpoint();
        }
    }

    while (true) {
        if (!validA) {
            var createA = call("POST /mitigation/A");
            if (/^201 Created\b/.test(nameOf(createA))) {
                validA = true;
                a = 0;
                dirty = true;
            } else if (nameOf(createA) === "401 Credential compromised") {
                recoverCredentials();
            } // 503 leaves A invalid and deterministically retries it.
            continue;
        }

        if (!validB) {
            var createB = call("POST /mitigation/B");
            if (/^201 Created\b/.test(nameOf(createB))) {
                validB = true;
                b = 0;
                dirty = true;
            } else if (nameOf(createB) === "401 Credential compromised") {
                recoverCredentials();
            } // 503 leaves B invalid and deterministically retries it.
            continue;
        }

        if (dirty) {
            var saved = call("POST /response-snapshot");
            if (nameOf(saved) === "201 Snapshotted") {
                snapA = a;
                snapB = b;
                haveSnapshot = true;
                dirty = false;
            } else if (nameOf(saved) === "401 Credential compromised") {
                recoverCredentials();
            } else { // 409 Invalid workspace: recover from the last checkpoint.
                validA = false;
                validB = false;
                dirty = false;
            }
            continue;
        }

        if (a < 2) {
            applyStage("A", a + 1);
            continue;
        }
        if (b < 2) {
            applyStage("B", b + 1);
            continue;
        }

        var reopened = call("POST /traffic/reopen");
        if (nameOf(reopened) === "201 Traffic reopened") {
            break; // Required terminal condition: make no further requests.
        }
        if (nameOf(reopened) === "401 Credential compromised") {
            recoverCredentials();
        } else { // 409 Unsafe to reopen: local state is no longer trusted.
            validA = false;
            validB = false;
        }
    }
});
