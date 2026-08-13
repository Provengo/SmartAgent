const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

// The partition generator replaces null with one of all 24 disruption orders.
bthread("Open coupled-zone attacker", function () {
  let disruptionOrder=["EVICTION","503","401","504"], disruptionIndex=0;
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

function registerIncidentController(body) {
  bthread("Blind agent incident controller", body);
}

function selectRequest(path) {
  bp.sync({request:E(path), block:RESPONSES});
}

function observeResponse() {
  return bp.sync({waitFor:RESPONSES, block:REQUESTS});
}

registerIncidentController(function () {
  var phase = "CREATE_A";
  var observed = null;
  var a = -1;
  var b = -1;
  var savedA = -1;
  var savedB = -1;
  var checkpointNeeded = false;
  var marker = -1;
  var reportedPrefix = -1;

  while (true) {
    /* DECIDE never sends a request: it turns our confirmed local prefix
       into the one next safe operation. */
    if (phase === "DECIDE") {
      if (a < 0) {
        phase = "CREATE_A";
      } else if (b < 0) {
        phase = "CREATE_B";
      } else if (checkpointNeeded) {
        phase = "SNAPSHOT";
      } else if (a === 0) {
        phase = "A1";
      } else if (b === 0) {
        phase = "B1";
      } else if (a === 1) {
        phase = "A2";
      } else if (b === 1) {
        phase = "B2";
      } else {
        phase = "REOPEN";
      }
    }

    if (phase === "CREATE_A") {
      selectRequest("POST /mitigation/A");
    } else if (phase === "CREATE_B") {
      selectRequest("POST /mitigation/B");
    } else if (phase === "A1") {
      selectRequest("PUT /mitigation/A/stage/1");
    } else if (phase === "B1") {
      selectRequest("PUT /mitigation/B/stage/1");
    } else if (phase === "A2") {
      selectRequest("PUT /mitigation/A/stage/2");
    } else if (phase === "B2") {
      selectRequest("PUT /mitigation/B/stage/2");
    } else if (phase === "STATUS_A") {
      selectRequest("GET /mitigation/A/status");
    } else if (phase === "STATUS_B") {
      selectRequest("GET /mitigation/B/status");
    } else if (phase === "SNAPSHOT") {
      selectRequest("POST /response-snapshot");
    } else if (phase === "RESTORE") {
      selectRequest("POST /response-snapshot/restore");
    } else if (phase === "ROTATE") {
      selectRequest("POST /credentials/rotate");
    } else {
      selectRequest("POST /traffic/reopen");
    }

    observed = observeResponse();

    /* A compromise has one uniform consequence regardless of the request
       which exposed it: ordinary workspaces are no longer usable. */
    if (observed.name === "401 Credential compromised") {
      a = -1;
      b = -1;
      checkpointNeeded = false;
      phase = "ROTATE";
    } else if (phase === "ROTATE") {
      if (savedA >= 0) {
        phase = "RESTORE";
      } else {
        phase = "DECIDE";
      }
    } else if (phase === "CREATE_A") {
      if (observed.name === "201 Created (A)") {
        a = 0;
        phase = "DECIDE";
      } else if (observed.name === "503 Control-plane flood") {
        phase = "CREATE_A";
      } else {
        a = -1;
        phase = "DECIDE";
      }
    } else if (phase === "CREATE_B") {
      if (observed.name === "201 Created (B)") {
        b = 0;
        phase = "DECIDE";
      } else if (observed.name === "503 Control-plane flood") {
        phase = "CREATE_B";
      } else {
        b = -1;
        phase = "DECIDE";
      }
    } else if (phase === "A1" || phase === "A2") {
      if (observed.name === "204 Applied") {
        a = a + 1;
        checkpointNeeded = !(a === 2 && b === 2);
        phase = "DECIDE";
      } else if (observed.name === "504 Edge timeout") {
        phase = "STATUS_A";
      } else if (observed.name === "409 Capacity eviction(A)") {
        a = -1;
        checkpointNeeded = false;
        phase = savedA >= 0 ? "RESTORE" : "DECIDE";
      } else if (observed.name === "409 Capacity eviction(B)") {
        b = -1;
        checkpointNeeded = false;
        phase = savedA >= 0 ? "RESTORE" : "DECIDE";
      } else {
        phase = "DECIDE";
      }
    } else if (phase === "B1" || phase === "B2") {
      if (observed.name === "204 Applied") {
        b = b + 1;
        checkpointNeeded = !(a === 2 && b === 2);
        phase = "DECIDE";
      } else if (observed.name === "504 Edge timeout") {
        phase = "STATUS_B";
      } else if (observed.name === "409 Capacity eviction(A)") {
        a = -1;
        checkpointNeeded = false;
        phase = savedA >= 0 ? "RESTORE" : "DECIDE";
      } else if (observed.name === "409 Capacity eviction(B)") {
        b = -1;
        checkpointNeeded = false;
        phase = savedA >= 0 ? "RESTORE" : "DECIDE";
      } else {
        phase = "DECIDE";
      }
    } else if (phase === "STATUS_A" || phase === "STATUS_B") {
      /* Status names carry the reported prefix.  This request is issued
         immediately after its matching timeout, before another stage. */
      marker = observed.name.indexOf("prefix ");
      if (marker >= 0) {
        reportedPrefix = parseInt(observed.name.substring(marker + 7, marker + 8));
      } else if (observed.name.indexOf(", 2") >= 0) {
        reportedPrefix = 2;
      } else if (observed.name.indexOf(", 1") >= 0) {
        reportedPrefix = 1;
      } else if (observed.name.indexOf("stage 2") >= 0) {
        reportedPrefix = 2;
      } else if (observed.name.indexOf("stage 1") >= 0) {
        reportedPrefix = 1;
      } else {
        reportedPrefix = 0;
      }
      if (phase === "STATUS_A") {
        if (reportedPrefix > a) {
          a = reportedPrefix;
          checkpointNeeded = !(a === 2 && b === 2);
        } else {
          a = reportedPrefix;
          checkpointNeeded = false;
        }
      } else {
        if (reportedPrefix > b) {
          b = reportedPrefix;
          checkpointNeeded = !(a === 2 && b === 2);
        } else {
          b = reportedPrefix;
          checkpointNeeded = false;
        }
      }
      phase = "DECIDE";
    } else if (phase === "SNAPSHOT") {
      if (observed.name === "201 Snapshotted") {
        savedA = a;
        savedB = b;
        checkpointNeeded = false;
        phase = "DECIDE";
      } else if (savedA >= 0) {
        phase = "RESTORE";
      } else {
        a = -1;
        b = -1;
        checkpointNeeded = false;
        phase = "DECIDE";
      }
    } else if (phase === "RESTORE") {
      if (observed.name === "201 Restored") {
        a = savedA;
        b = savedB;
        checkpointNeeded = false;
        phase = "DECIDE";
      } else {
        savedA = -1;
        savedB = -1;
        a = -1;
        b = -1;
        checkpointNeeded = false;
        phase = "DECIDE";
      }
    } else {
      if (observed.name === "201 Traffic reopened") {
        return;
      }
      if (savedA >= 0) {
        phase = "RESTORE";
      } else {
        a = -1;
        b = -1;
        phase = "DECIDE";
      }
    }
  }
});
