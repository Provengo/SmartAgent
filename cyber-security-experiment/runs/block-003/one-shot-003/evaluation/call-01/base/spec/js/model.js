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

/* Deterministic defensive controller.  All state below is learned from replies. */
bp.registerBThread("causal two-zone recovery controller", function () {
    // -1 means no current-epoch workspace; 0..2 are confirmed applied prefixes.
    var a = -1;
    var b = -1;
    // The last durable, atomically confirmed pair.  It is retained across rotation.
    var snapA = -1;
    var snapB = -1;
    var restoreNeeded = false;
    var rotateNeeded = false;

    function nameOf(event) {
        return String(event.name);
    }

    // One request is always followed by exactly one observed response.
    function request(path) {
        bp.sync({request: E(path), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }

    function is(response, code) {
        return nameOf(response).indexOf(code + " ") === 0;
    }

    function evictionVictim(response) {
        var text = nameOf(response);
        if (/\bA\b/.test(text)) { return "A"; }
        if (/\bB\b/.test(text)) { return "B"; }
        return "";
    }

    // Status text carries a single prefix (0, 1, or 2) after its HTTP code.
    function reportedPrefix(response) {
        var detail = nameOf(response).replace(/^\d{3}\s+/, "");
        var labelled = detail.match(/(?:prefix|stage)\s*(?:=|:)?\s*([012])\b/i);
        var values = detail.match(/\b[012]\b/g);
        if (labelled) { return Number(labelled[1]); }
        if (values && values.length) { return Number(values[values.length - 1]); }
        return -1; // Never count an unparseable timeout outcome as applied.
    }

    while (true) {
        var observed;

        if (rotateNeeded) {
            observed = request("POST /credentials/rotate");
            // Rotation is the only unprotected request; its 200 starts a new epoch.
            if (is(observed, "200")) {
                a = -1;
                b = -1;
                rotateNeeded = false;
                restoreNeeded = true;
            }
            continue;
        }

        if (restoreNeeded) {
            observed = request("POST /response-snapshot/restore");
            if (is(observed, "201")) {
                a = snapA;
                b = snapB;
                restoreNeeded = false;
            } else if (is(observed, "401")) {
                rotateNeeded = true;
            } else {
                // Defensive legal 409 fallback: rebuild and establish a fresh checkpoint.
                a = -1;
                b = -1;
                snapA = -1;
                snapB = -1;
                restoreNeeded = false;
            }
            continue;
        }

        if (a < 0) {
            observed = request("POST /mitigation/A");
            if (is(observed, "201")) { a = 0; }
            else if (is(observed, "401")) { rotateNeeded = true; }
            // A lone 503 is retried; it creates no workspace and consumes no progress.
            continue;
        }
        if (b < 0) {
            observed = request("POST /mitigation/B");
            if (is(observed, "201")) { b = 0; }
            else if (is(observed, "401")) { rotateNeeded = true; }
            continue;
        }

        if (a === 2 && b === 2) {
            observed = request("POST /traffic/reopen");
            if (nameOf(observed) === "201 Traffic reopened") { break; }
            if (is(observed, "401")) { rotateNeeded = true; }
            else {
                // A legal unsafe reopen contradicts no confirmed state; re-check safely.
                restoreNeeded = true;
            }
            continue;
        }

        // Checkpoint every incomplete confirmed pair before exposing the next stage.
        if (a !== snapA || b !== snapB) {
            observed = request("POST /response-snapshot");
            if (is(observed, "201")) {
                snapA = a;
                snapB = b;
            } else if (is(observed, "401")) {
                rotateNeeded = true;
            } else {
                // Invalid-workspace fallback keeps local state conservative.
                a = -1;
                b = -1;
            }
            continue;
        }

        var zone = a < 2 ? "A" : "B";
        var prefix = zone === "A" ? a : b;
        observed = request("PUT /mitigation/" + zone + "/stage/" + (prefix + 1));

        if (is(observed, "204")) {
            if (zone === "A") { a = prefix + 1; }
            else { b = prefix + 1; }
        } else if (is(observed, "401")) {
            // The checkpoint was taken immediately before this vulnerable request.
            rotateNeeded = true;
        } else if (is(observed, "504")) {
            // A timeout is ambiguous: status, rather than this reply, decides the prefix.
            observed = request("GET /mitigation/" + zone + "/status");
            if (is(observed, "200")) {
                prefix = reportedPrefix(observed);
                if (prefix >= 0) {
                    if (zone === "A") { a = prefix; }
                    else { b = prefix; }
                } else {
                    restoreNeeded = true;
                }
            } else if (is(observed, "401")) {
                rotateNeeded = true;
            } else {
                restoreNeeded = true;
            }
        } else if (is(observed, "409")) {
            // Eviction applies no stage; restore the pre-stage atomic checkpoint.
            if (evictionVictim(observed) === "A") { a = -1; }
            else if (evictionVictim(observed) === "B") { b = -1; }
            restoreNeeded = true;
        }
    }
});
