function registerIncidentController(body) {
  bthread("Blind agent incident controller", body);
}

function selectRequest(path) {
  bp.sync({request:E(path), block:RESPONSES});
}

function observeResponse() {
  return bp.sync({waitFor:RESPONSES, block:REQUESTS});
}
