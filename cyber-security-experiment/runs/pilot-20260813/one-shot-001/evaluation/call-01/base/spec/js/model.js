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

bp.registerBThread("deterministic coupled-zone recovery controller", function () {
    // Confirmed prefixes; -1 means that this epoch has no usable workspace.
    var a = -1, b = -1;
    // The only durable checkpoint this policy creates is the confirmed (1,1) pair.
    var checkpoint = false;
    var compromised = false;
    var restoreNeeded = false;
    // One use each of 503, 401, 504, and eviction adds at most 1+4+2+2
    // requests to the eight-request clean path, so this policy stays below 20.

    function nameOf(event) {
        return String(event.name);
    }

    function request(path) {
        bp.sync({request: E(path), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }

    function isCompromised(response) {
        return nameOf(response).indexOf("401 ") === 0;
    }

    function isEviction(response) {
        return nameOf(response).indexOf("409 Capacity eviction") === 0;
    }

    function statusPrefix(response) {
        // Ignore the HTTP code, then accept the contract's textual status form.
        var text = nameOf(response).replace(/^\d+\s+/, "");
        if (/(prefix|stage|status)[^0-9]*2\b/i.test(text)) return 2;
        if (/(prefix|stage|status)[^0-9]*1\b/i.test(text)) return 1;
        return 0;
    }

    function rememberStage(zone, prefix) {
        if (zone === "A") a = prefix;
        else b = prefix;
    }

    function prefixOf(zone) {
        return zone === "A" ? a : b;
    }

    while (true) {
        var action, response, zone, before;

        // A 401 makes every ordinary workspace stale; rotate before any retry.
        if (compromised) {
            response = request("POST /credentials/rotate");
            if (nameOf(response).indexOf("200 Rotated") === 0) {
                compromised = false;
                if (checkpoint) restoreNeeded = true;
                else { a = -1; b = -1; }
            }
            continue;
        }

        // Restoring is atomic, so it deliberately discards any newer lone prefix.
        if (restoreNeeded) {
            response = request("POST /response-snapshot/restore");
            if (isCompromised(response)) { compromised = true; continue; }
            if (nameOf(response).indexOf("201 Restored") === 0) {
                a = 1; b = 1; restoreNeeded = false;
            } else { // 409 No snapshot: rebuild conservatively.
                checkpoint = false; restoreNeeded = false; a = -1; b = -1;
            }
            continue;
        }

        if (a < 0 || b < 0) {
            zone = a < 0 ? "A" : "B";
            response = request("POST /mitigation/" + zone);
            if (isCompromised(response)) { compromised = true; continue; }
            // 503 is globally single-use, so retaining -1 deterministically retries.
            if (nameOf(response).indexOf("201 Created") === 0) rememberStage(zone, 0);
            continue;
        }

        // Do not risk stage 2 until the coupled stage-1 checkpoint is durable.
        if (!checkpoint && a >= 1 && b >= 1) {
            response = request("POST /response-snapshot");
            if (isCompromised(response)) { compromised = true; continue; }
            if (nameOf(response).indexOf("201 Snapshotted") === 0) checkpoint = true;
            else { a = -1; b = -1; } // Invalid workspace is rebuilt before retrying.
            continue;
        }

        if (a < 2 || b < 2) {
            // Finish both first stages before either second stage.
            if (a < 1) zone = "A";
            else if (b < 1) zone = "B";
            else if (a < 2) zone = "A";
            else zone = "B";
            before = prefixOf(zone);
            action = "PUT /mitigation/" + zone + "/stage/" + (before + 1);
            response = request(action);

            if (isCompromised(response)) { compromised = true; continue; }
            if (nameOf(response).indexOf("204 Applied") === 0) {
                rememberStage(zone, before + 1);
            } else if (nameOf(response).indexOf("504 Edge timeout") === 0) {
                // A timeout is ambiguous: status is the required causal resolver.
                response = request("GET /mitigation/" + zone + "/status");
                if (isCompromised(response)) { compromised = true; continue; }
                rememberStage(zone, statusPrefix(response) >= before + 1 ? before + 1 : before);
            } else if (isEviction(response)) {
                // A checkpoint repairs either possible victim without trusting it.
                if (checkpoint) restoreNeeded = true;
                else {
                    if (nameOf(response).indexOf("(A)") >= 0 || /\bA\b/.test(nameOf(response))) a = -1;
                    else b = -1;
                }
            }
            continue;
        }

        response = request("POST /traffic/reopen");
        if (nameOf(response).indexOf("201 Traffic reopened") === 0) return;
        if (isCompromised(response)) { compromised = true; continue; }
        // Unsafe reopen cannot justify trusting stage 2; return to the checkpoint.
        if (checkpoint) restoreNeeded = true;
        else { a = -1; b = -1; }
    }
});
