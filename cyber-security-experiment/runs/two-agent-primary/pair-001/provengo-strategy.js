registerIncidentController(function () {
  var phase = "CREATE_A";
  var observed = null;
  var pending = "";
  var pA = 0;
  var pB = 0;
  var sA = 0;
  var sB = 0;
  var attemptPrefix = 0;

  while (true) {
    if (phase === "PLAN") {
      if (pA < 1) phase = "A1";
      else if (pA < 2) phase = "A2";
      else if (pB < 1) phase = "B1";
      else if (pB < 2) phase = "B2";
      else phase = "REOPEN";
    }

    if (phase === "CREATE_A") {
      selectRequest("POST /mitigation/A");
    } else if (phase === "CREATE_B") {
      selectRequest("POST /mitigation/B");
    } else if (phase === "SNAP") {
      selectRequest("POST /response-snapshot");
    } else if (phase === "A1") {
      pending = "A";
      attemptPrefix = pA;
      selectRequest("PUT /mitigation/A/stage/1");
    } else if (phase === "A2") {
      pending = "A";
      attemptPrefix = pA;
      selectRequest("PUT /mitigation/A/stage/2");
    } else if (phase === "B1") {
      pending = "B";
      attemptPrefix = pB;
      selectRequest("PUT /mitigation/B/stage/1");
    } else if (phase === "B2") {
      pending = "B";
      attemptPrefix = pB;
      selectRequest("PUT /mitigation/B/stage/2");
    } else if (phase === "STATUS_A") {
      selectRequest("GET /mitigation/A/status");
    } else if (phase === "STATUS_B") {
      selectRequest("GET /mitigation/B/status");
    } else if (phase === "ROTATE") {
      selectRequest("POST /credentials/rotate");
    } else if (phase === "RESTORE") {
      selectRequest("POST /response-snapshot/restore");
    } else {
      selectRequest("POST /traffic/reopen");
    }

    observed = observeResponse();

    if (phase === "CREATE_A") {
      if (observed.name.equals("201 Created (A)")) phase = "CREATE_B";
      else if (observed.name.equals("401 Credential compromised")) phase = "ROTATE";
    } else if (phase === "CREATE_B") {
      if (observed.name.equals("201 Created (B)")) phase = "SNAP";
      else if (observed.name.equals("401 Credential compromised")) phase = "ROTATE";
    } else if (phase === "SNAP") {
      if (observed.name.equals("201 Snapshotted")) {
        sA = pA;
        sB = pB;
        phase = "PLAN";
      } else if (observed.name.equals("401 Credential compromised")) phase = "ROTATE";
      else phase = "RESTORE";
    } else if (phase === "A1" || phase === "A2" || phase === "B1" || phase === "B2") {
      if (observed.name.equals("204 Applied")) {
        if (pending === "A") pA++;
        else pB++;
        phase = "SNAP";
      } else if (observed.name.equals("401 Credential compromised")) phase = "ROTATE";
      else if (observed.name.equals("504 Edge timeout")) {
        if (pending === "A") phase = "STATUS_A";
        else phase = "STATUS_B";
      } else phase = "RESTORE";
    } else if (phase === "STATUS_A" || phase === "STATUS_B") {
      if (observed.name.equals("401 Credential compromised")) phase = "ROTATE";
      else {
        if (phase === "STATUS_A") {
          pA = parseInt(observed.name.substring(observed.name.indexOf("Prefix(") + 7));
          if (pA > attemptPrefix) phase = "SNAP";
          else phase = "PLAN";
        } else {
          pB = parseInt(observed.name.substring(observed.name.indexOf("Prefix(") + 7));
          if (pB > attemptPrefix) phase = "SNAP";
          else phase = "PLAN";
        }
      }
    } else if (phase === "ROTATE") {
      phase = "RESTORE";
    } else if (phase === "RESTORE") {
      if (observed.name.equals("201 Restored")) {
        pA = sA;
        pB = sB;
        phase = "PLAN";
      } else if (observed.name.equals("401 Credential compromised")) phase = "ROTATE";
      else {
        pA = 0;
        pB = 0;
        sA = 0;
        sB = 0;
        phase = "CREATE_A";
      }
    } else {
      if (observed.name.equals("201 Traffic reopened")) return;
      else if (observed.name.equals("401 Credential compromised")) phase = "ROTATE";
      else phase = "PLAN";
    }
  }
});
