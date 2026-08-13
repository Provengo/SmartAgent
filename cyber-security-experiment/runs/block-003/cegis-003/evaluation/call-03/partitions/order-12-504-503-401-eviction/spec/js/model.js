const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

// The partition generator replaces null with one of all 24 disruption orders.
bthread("Open coupled-zone attacker", function () {
  let disruptionOrder=["504","503","401","EVICTION"], disruptionIndex=0;
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
    // -1 is absent; 0..2 are observed, current workspace prefixes.
    let a = -1, b = -1;
    let snapA = -1, snapB = -1; // The one durable coupled checkpoint.
    let compromised = false, evicted = null;

    function send(name) {
        bp.sync({request: E(name), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }
    function named(e, s) { return e.name.equals(s); }
    function is(e, code) { return e.name.indexOf(code + " ") === 0; }
    function prefix(e, requested) {
        let re = new RegExp("(^|[^0-9])" + requested + "([^0-9]|$)");
        return re.test(e.name) ? requested : requested - 1;
    }
    function create(zone) {
        let r = send("POST /mitigation/" + zone);
        if (is(r, "401")) { compromised = true; return -1; }
        return is(r, "503") ? -1 : 0;
    }
    function apply(zone, old) {
        let wanted = old + 1, r = send("PUT /mitigation/" + zone + "/stage/" + wanted);
        if (named(r, "204 Applied")) return wanted;
        if (is(r, "401")) { compromised = true; return old; }
        if (is(r, "504")) {
            let status = send("GET /mitigation/" + zone + "/status");
            if (is(status, "401")) { compromised = true; return old; }
            return prefix(status, wanted);
        }
        if (is(r, "409")) evicted = r.name.indexOf("(A)") !== -1 ? "A" : "B";
        return old;
    }
    function checkpoint() {
        let r = send("POST /response-snapshot");
        if (is(r, "401")) { compromised = true; return; }
        if (named(r, "201 Snapshotted")) { snapA = a; snapB = b; }
    }
    function restore() {
        let r = send("POST /response-snapshot/restore");
        if (is(r, "401")) { compromised = true; return; }
        if (named(r, "201 Restored")) { a = snapA; b = snapB; }
        else { snapA = -1; snapB = -1; a = -1; b = -1; }
    }

    while (true) {
        if (compromised) {
            send("POST /credentials/rotate");
            compromised = false;
            if (snapA >= 0) restore(); else { a = -1; b = -1; }
            continue;
        }
        if (a < 0) { a = create("A"); continue; }
        if (b < 0) { b = create("B"); continue; }

        // Once A is complete, preserve it before B can expose it to eviction.
        if (a === 2 && b === 0 && snapA < 0) { checkpoint(); continue; }

        if (a < 2 || b < 2) {
            let zone = a < 2 ? "A" : "B";
            evicted = null;
            let next = apply(zone, zone === "A" ? a : b);
            if (evicted !== null) {
                // Restore the coupled checkpoint when available; it avoids
                // rebuilding a completed zone and intentionally rolls back B.
                if (snapA >= 0) restore();
                else if (evicted === "A") a = -1;
                else b = -1;
            } else if (zone === "A") a = next;
            else b = next;
            continue;
        }

        let r = send("POST /traffic/reopen");
        if (named(r, "201 Traffic reopened")) return;
        if (is(r, "401")) compromised = true;
        else { a = -1; b = -1; snapA = -1; snapB = -1; }
    }
});
