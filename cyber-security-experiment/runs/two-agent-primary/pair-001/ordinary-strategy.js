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
