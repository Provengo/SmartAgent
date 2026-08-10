const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);

// History-dependent candidate policy. It sees responses, never server variables.
bthread("Guided L4 controller", function () {
  let phase = "CREATE", nextChunk = 1, ambiguousChunk = 0;
  let checkpointed = 0, expirySeen = false, observed;
  while (true) {
    if (phase === "CREATE") bp.sync({request:E("POST /backup-sessions"), block:RESPONSES});
    else if (phase === "UPLOAD") bp.sync({request:E("PUT /backup-sessions/current/chunks/" + nextChunk), block:RESPONSES});
    else if (phase === "STATUS") bp.sync({request:E("GET /backup-sessions/current/status"), block:RESPONSES});
    else if (phase === "CHECKPOINT") bp.sync({request:E("POST /backup-sessions/current/checkpoint"), block:RESPONSES});
    else if (phase === "REFRESH") bp.sync({request:E("POST /auth/refresh"), block:RESPONSES});
    else if (phase === "RESTORE") bp.sync({request:E("POST /backup-sessions/checkpoint/restore"), block:RESPONSES});
    else bp.sync({request:E("POST /backup-sessions/current/commit"), block:RESPONSES});

    observed = bp.sync({waitFor:RESPONSES, block:REQUESTS});
    if (observed.name.equals("503 Service Unavailable")) phase = "CREATE";
    else if (observed.name.equals("201 Created (session)")) { nextChunk = 1; phase = "UPLOAD"; }
    else if (observed.name.equals("204 No Content")) {
      nextChunk++;
      if (nextChunk === 3 && !expirySeen) phase = "CHECKPOINT";
      else if (nextChunk === 5) phase = "COMMIT";
      else phase = "UPLOAD";
    } else if (observed.name.equals("401 Unauthorized")) {
      expirySeen = true; phase = "REFRESH";
    } else if (observed.name.equals("504 Gateway Timeout")) {
      ambiguousChunk = nextChunk; phase = "STATUS";
    } else if (observed.name.indexOf("200 Prefix(") === 0) {
      let reported = parseInt(observed.name.substring(11));
      nextChunk = reported >= ambiguousChunk ? reported + 1 : ambiguousChunk;
      if (nextChunk === 3 && !expirySeen) phase = "CHECKPOINT";
      else if (nextChunk === 5) phase = "COMMIT";
      else phase = "UPLOAD";
    } else if (observed.name.equals("201 Checkpointed")) {
      checkpointed = 2; phase = "UPLOAD";
    } else if (observed.name.equals("200 OK (token refreshed)")) {
      phase = checkpointed > 0 ? "RESTORE" : "CREATE";
    } else if (observed.name.equals("201 Restored")) {
      nextChunk = checkpointed + 1; phase = "UPLOAD";
    } else if (observed.name.equals("201 Created (backup committed)")) break;
    else bp.ASSERT(false, "STRATEGY_FAILURE: unexpected recovery response " + observed.name);
  }
});

// Open server: all legal response choices remain requested.
bthread("Open L4 REST server", function () {
  let outageUsed=false, expiryUsed=false, expired=false, timeoutUsed=false;
  let tokenEpoch=0, sessionEpoch=-1, prefix=0, checkpointPrefix=0;
  let ambiguous=0, requestEvent, responseEvent;
  while (true) {
    requestEvent = waitFor(REQUESTS);
    if (requestEvent.name.equals("POST /backup-sessions")) {
      if (expired) responseEvent = bp.sync({request:E("401 Unauthorized")});
      else {
        responseEvent = bp.sync({request:outageUsed ? E("201 Created (session)") : [E("201 Created (session)"),E("503 Service Unavailable")]});
        if (responseEvent.name.equals("503 Service Unavailable")) outageUsed=true;
        else { sessionEpoch=tokenEpoch; prefix=0; ambiguous=0; }
      }
    } else if (requestEvent.name.indexOf("PUT /backup-sessions/current/chunks/") === 0) {
      if (expired) bp.sync({request:E("401 Unauthorized")});
      else {
        let legal=[E("204 No Content")];
        if (!expiryUsed) legal.push(E("401 Unauthorized"));
        if (!timeoutUsed) legal.push(E("504 Gateway Timeout"));
        responseEvent=bp.sync({request:legal});
        if (responseEvent.name.equals("401 Unauthorized")) { expiryUsed=true; expired=true; }
        else if (responseEvent.name.equals("504 Gateway Timeout")) { timeoutUsed=true; ambiguous=prefix+1; }
        else { prefix++; ambiguous=0; }
      }
    } else if (requestEvent.name.equals("GET /backup-sessions/current/status")) {
      if (expired) bp.sync({request:E("401 Unauthorized")});
      else if (ambiguous>0) {
        responseEvent=bp.sync({request:[E("200 Prefix("+prefix+")"),E("200 Prefix("+ambiguous+")")]});
        if (responseEvent.name.equals("200 Prefix("+ambiguous+")")) prefix=ambiguous;
        ambiguous=0;
      } else bp.sync({request:E("200 Prefix("+prefix+")")});
    } else if (requestEvent.name.equals("POST /auth/refresh")) {
      bp.sync({request:E("200 OK (token refreshed)")}); tokenEpoch++; expired=false;
    } else if (requestEvent.name.equals("POST /backup-sessions/current/checkpoint")) {
      if (expired) bp.sync({request:E("401 Unauthorized")});
      else if (sessionEpoch===tokenEpoch) { bp.sync({request:E("201 Checkpointed")}); checkpointPrefix=prefix; }
      else bp.sync({request:E("409 Invalid Session")});
    } else if (requestEvent.name.equals("POST /backup-sessions/checkpoint/restore")) {
      if (expired) bp.sync({request:E("401 Unauthorized")});
      else if (checkpointPrefix>0) { bp.sync({request:E("201 Restored")}); sessionEpoch=tokenEpoch; prefix=checkpointPrefix; }
      else bp.sync({request:E("409 No Checkpoint")});
    } else {
      let valid=sessionEpoch===tokenEpoch && prefix===4 && !expired;
      bp.sync({request:E(valid ? "201 Created (backup committed)" : "409 Invalid Session")});
      if (valid) break;
    }
  }
});

bthread("L4 bounded-success monitor", function () {
  let count=0, responseEvent;
  while (true) {
    waitFor(REQUESTS); count++;
    bp.ASSERT(count<=14,"BOUNDED_REACHABILITY_FAILURE: more than 14 requests");
    responseEvent=waitFor(RESPONSES);
    if (responseEvent.name.equals("201 Created (backup committed)")) break;
  }
});
