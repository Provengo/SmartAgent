registerIncidentController(function () {
  var phase = "A";
  var observed = null;
  while (true) {
    if (phase === "A") selectRequest("POST /mitigation/A");
    else selectRequest("POST /mitigation/B");
    observed = observeResponse();
    if (observed.name === "201 Created (A)") phase = "B";
  }
});
