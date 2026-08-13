const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

// The partition generator replaces null with one of all 24 disruption orders.
bthread("Open coupled-zone attacker", function () {
  let disruptionOrder=["EVICTION","504","401","503"], disruptionIndex=0;
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
 * One controller b-thread.  prefixA/prefixB are the last *snapshotted*
 * confirmed prefixes; haveSnapshot says that those prefixes are restorable.
 * Checkpointing at 0 and after every stage bounds the four one-shot faults:
 * 12 normal requests + 503 retry + timeout/status/retry + eviction/restore/retry
 * + expiry/rotate/restore/retry = 20 requests in the worst compatible order.
 */
bp.registerBThread("deterministic causal recovery controller", function () {
    var prefixA = 0;
    var prefixB = 0;
    var haveSnapshot = false;
    var checkpointNeeded = true;

    // A turn always selects a request, then observes exactly its one response.
    function turn(requestName) {
        bp.sync({request: E(requestName), block: RESPONSES});
        return bp.sync({waitFor: RESPONSES, block: REQUESTS});
    }

    function nameOf(event) {
        return event.name || "";
    }

    function is(event, code) {
        return nameOf(event).indexOf(code + " ") === 0;
    }

    // Creation is retried only on its single legal transient failure.
    function createBothAtZero() {
        var response;
        do {
            response = turn("POST /mitigation/A");
        } while (is(response, "503"));
        do {
            response = turn("POST /mitigation/B");
        } while (is(response, "503"));
        prefixA = 0;
        prefixB = 0;
        haveSnapshot = false;
        checkpointNeeded = true;
    }

    // After expiry, restore the remembered checkpoint; without one, rebuild.
    function recoverCheckpoint() {
        var response = turn("POST /credentials/rotate");
        // Rotation's legal response is 200 Rotated.
        while (!is(response, "200")) {
            response = turn("POST /credentials/rotate");
        }

        if (!haveSnapshot) {
            createBothAtZero();
            return;
        }

        response = turn("POST /response-snapshot/restore");
        if (is(response, "201")) {
            checkpointNeeded = false;
        } else if (is(response, "401")) {
            // Defensive legal-response handling: rotate again before restore.
            recoverCheckpoint();
        } else {
            // 409 means no usable durable checkpoint, so restart at prefix 0.
            createBothAtZero();
        }
    }

    createBothAtZero();

    for (;;) {
        var response;

        if (checkpointNeeded) {
            response = turn("POST /response-snapshot");
            if (is(response, "201")) {
                haveSnapshot = true;
                checkpointNeeded = false;
                continue;
            }
            if (is(response, "401")) {
                recoverCheckpoint();
                continue;
            }
            // Invalid workspaces cannot be trusted as a checkpoint.
            createBothAtZero();
            continue;
        }

        if (prefixA === 2 && prefixB === 2) {
            response = turn("POST /traffic/reopen");
            if (is(response, "201")) {
                // 201 Traffic reopened is the terminal success event.
                return;
            }
            if (is(response, "401")) {
                recoverCheckpoint();
            } else {
                // Unsafe reopen contradicts this checkpoint; restore it first.
                if (haveSnapshot) {
                    response = turn("POST /response-snapshot/restore");
                    if (is(response, "201")) {
                        checkpointNeeded = false;
                    } else if (is(response, "401")) {
                        recoverCheckpoint();
                    } else {
                        createBothAtZero();
                    }
                } else {
                    createBothAtZero();
                }
            }
            continue;
        }

        // Fixed A-then-B order makes the policy deterministic and causal.
        var zone = prefixA < 2 ? "A" : "B";
        var nextPrefix = zone === "A" ? prefixA + 1 : prefixB + 1;
        response = turn("PUT /mitigation/" + zone + "/stage/" + nextPrefix);

        if (is(response, "204")) {
            if (zone === "A") {
                prefixA = nextPrefix;
            } else {
                prefixB = nextPrefix;
            }
            checkpointNeeded = true;
            continue;
        }

        if (is(response, "401")) {
            // Credential rotation invalidates both ordinary workspaces.
            recoverCheckpoint();
            continue;
        }

        if (is(response, "409")) {
            // Eviction applied no stage: restore the last atomic checkpoint.
            if (haveSnapshot) {
                response = turn("POST /response-snapshot/restore");
                if (is(response, "201")) {
                    checkpointNeeded = false;
                } else if (is(response, "401")) {
                    recoverCheckpoint();
                } else {
                    createBothAtZero();
                }
            } else {
                createBothAtZero();
            }
            continue;
        }

        // A 504 is ambiguous: status is the causal observation that resolves it.
        response = turn("GET /mitigation/" + zone + "/status");
        if (is(response, "401")) {
            recoverCheckpoint();
            continue;
        }
        if (is(response, "200")) {
            var status = nameOf(response);
            var reported = /\b2\b/.test(status) ? 2 : (/\b1\b/.test(status) ? 1 : 0);
            if (reported >= nextPrefix) {
                if (zone === "A") {
                    prefixA = reported;
                } else {
                    prefixB = reported;
                }
                checkpointNeeded = true;
            }
            // Otherwise the loop deterministically retries the unconfirmed stage.
        } else if (is(response, "409")) {
            // Defensive branch for a reported invalid workspace.
            createBothAtZero();
        }
    }
});
