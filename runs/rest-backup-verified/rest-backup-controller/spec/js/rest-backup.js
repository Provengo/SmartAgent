// REST requests are controller events; HTTP responses are open-server events.
const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503) /);

bthread("Verified REST backup controller", function () {
  let response;
  while (true) {
    while (true) {
      bp.sync({request: E("POST /backup-sessions"), block: RESPONSES});
      response = bp.sync({waitFor: [E("201 Created (session)"), E("503 Service Unavailable")], block: REQUESTS});
      if (response.name.equals("201 Created (session)")) break;
    }
    bp.sync({request: E("PUT /backup-sessions/current/chunks/1"), block: RESPONSES});
    response = bp.sync({waitFor: [E("204 No Content"), E("401 Unauthorized")], block: REQUESTS});
    if (response.name.equals("401 Unauthorized")) {
      bp.sync({request: E("POST /auth/refresh"), block: RESPONSES});
      bp.sync({waitFor: E("200 OK (token refreshed)"), block: REQUESTS});
      continue;
    }
    bp.sync({request: E("PUT /backup-sessions/current/chunks/2"), block: RESPONSES});
    response = bp.sync({waitFor: [E("204 No Content"), E("401 Unauthorized")], block: REQUESTS});
    if (response.name.equals("401 Unauthorized")) {
      bp.sync({request: E("POST /auth/refresh"), block: RESPONSES});
      bp.sync({waitFor: E("200 OK (token refreshed)"), block: REQUESTS});
      continue;
    }
    bp.sync({request: E("POST /backup-sessions/current/commit"), block: RESPONSES});
    const committed = bp.sync({waitFor: E("201 Created (backup committed)"), block: REQUESTS});
    bp.ASSERT(committed.name.equals("201 Created (backup committed)"), "COMMIT_FAILURE");
    break;
  }
});

bthread("Open REST server", function () {
  let outages = 0, authFailures = 0, tokenEpoch = 0, sessionEpoch = -1;
  let chunk1 = false, chunk2 = false;
  let observedRequest, serverResponse;
  while (true) {
    observedRequest = waitFor(REQUESTS);
    if (observedRequest.name.equals("POST /backup-sessions")) {
      serverResponse = bp.sync({request: outages < 1
        ? [E("201 Created (session)"), E("503 Service Unavailable")]
        : E("201 Created (session)")});
      if (serverResponse.name.equals("503 Service Unavailable")) outages++;
      else { sessionEpoch = tokenEpoch; chunk1 = false; chunk2 = false; }
    } else if (observedRequest.name.equals("POST /auth/refresh")) {
      bp.sync({request: E("200 OK (token refreshed)")});
      tokenEpoch++;
    } else if (observedRequest.name.equals("POST /backup-sessions/current/commit")) {
      const valid = sessionEpoch === tokenEpoch && chunk1 && chunk2;
      bp.sync({request: E(valid ? "201 Created (backup committed)" : "409 Invalid Session")});
      if (valid) break;
    } else {
      serverResponse = bp.sync({request: authFailures < 1
        ? [E("204 No Content"), E("401 Unauthorized")]
        : E("204 No Content")});
      if (serverResponse.name.equals("401 Unauthorized")) authFailures++;
      else if (observedRequest.name.equals("PUT /backup-sessions/current/chunks/1")) chunk1 = true;
      else chunk2 = true;
    }
  }
});

bthread("Bounded success monitor", function () {
  let count = 0;
  let observedResponse;
  while (true) {
    waitFor(REQUESTS); count++;
    bp.ASSERT(count <= 9, "BOUNDED_REACHABILITY_FAILURE: more than 9 requests");
    observedResponse = waitFor(RESPONSES);
    if (observedResponse.name.equals("201 Created (backup committed)")) break;
  }
});
