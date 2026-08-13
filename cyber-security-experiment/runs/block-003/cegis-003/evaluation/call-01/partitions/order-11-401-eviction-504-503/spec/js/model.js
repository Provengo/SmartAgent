const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

// The partition generator replaces null with one of all 24 disruption orders.
bthread("Open coupled-zone attacker", function () {
  let disruptionOrder=["401","EVICTION","504","503"], disruptionIndex=0;
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
    // -1 means no usable workspace; 0, 1, and 2 are confirmed stage prefixes.
    let a = -1;
    let b = -1;
    let compromised = false;
    let evicted = null;

    // Worst case is 7 normal requests + 1 flood + 2 timeout resolution/retry
    // + 3 eviction repair + 7 credential-reset recovery = exactly 20 requests.

    function send(requestName) {
        bp.sync({request: E(requestName), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }

    function is(response, text) {
        return response.name === text;
    }

    function is401(response) {
        return response.name.indexOf("401 ") === 0;
    }

    function is503(response) {
        return response.name.indexOf("503 ") === 0;
    }

    function is504(response) {
        return response.name.indexOf("504 ") === 0;
    }

    function is409(response) {
        return response.name.indexOf("409 ") === 0;
    }

    function observedPrefix(response, requestedStage) {
        // After a timeout, status can only be the prior prefix or this stage.
        // Test for the requested digit as a complete number, not the 200 code.
        let digit = String(requestedStage);
        let pattern = new RegExp("(^|[^0-9])" + digit + "([^0-9]|$)");
        return pattern.test(response.name) ? requestedStage : requestedStage - 1;
    }

    function create(zone) {
        let response = send("POST /mitigation/" + zone);
        if (is401(response)) {
            compromised = true;
            return -1;
        }
        // 503 leaves the old remembered value (-1), so this choice is retried.
        if (is503(response)) {
            return -1;
        }
        return 0; // The remaining legal create response is 201 Created.
    }

    function stage(zone, prefix) {
        let next = prefix + 1;
        let response = send("PUT /mitigation/" + zone + "/stage/" + next);

        if (is(response, "204 Applied")) {
            return next;
        }
        if (is401(response)) {
            compromised = true;
            return prefix;
        }
        if (is504(response)) {
            // The mandatory status observation resolves the otherwise hidden outcome.
            let status = send("GET /mitigation/" + zone + "/status");
            if (is401(status)) {
                compromised = true;
                return prefix;
            }
            return observedPrefix(status, next);
        }

        // 409 is capacity eviction: no stage was applied and one named workspace died.
        if (is409(response)) {
            evicted = response.name.indexOf("A") !== -1 ? "A" : "B";
        }
        return prefix;
    }

    while (true) {
        if (compromised) {
            // Rotation changes the shared epoch, invalidating every ordinary workspace.
            send("POST /credentials/rotate");
            a = -1;
            b = -1;
            compromised = false;
            continue;
        }

        // Both workspaces are established before either stage is selected.
        if (a === -1) {
            a = create("A");
            continue;
        }
        if (b === -1) {
            b = create("B");
            continue;
        }

        // Fixed A-then-B order makes the policy deterministic and causal.
        if (a < 2) {
            evicted = null;
            let nextA = stage("A", a);
            if (evicted === "A") {
                a = -1;
            } else {
                a = nextA;
            }
            if (evicted === "B") {
                b = -1;
            }
            continue;
        }
        if (b < 2) {
            evicted = null;
            let nextB = stage("B", b);
            if (evicted === "B") {
                b = -1;
            } else {
                b = nextB;
            }
            if (evicted === "A") {
                a = -1;
            }
            continue;
        }

        let reopened = send("POST /traffic/reopen");
        if (is(reopened, "201 Traffic reopened")) {
            return; // Required terminal event: issue no further requests.
        }
        if (is401(reopened)) {
            compromised = true;
            continue;
        }

        // Defensive total recovery for the only other legal reopen result, 409 Unsafe.
        a = -1;
        b = -1;
    }
});
