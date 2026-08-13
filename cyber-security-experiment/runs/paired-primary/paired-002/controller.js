bp.registerBThread("deterministic coupled-zone recovery", function () {
  // Confirmed local view of the current credential epoch only.
  var validA = false, validB = false;
  var prefixA = 0, prefixB = 0;
  var compromised = false;

  function requestThenObserve(path) {
    bp.sync({request: E(path), block: RESPONSES});
    return bp.sync({waitFor: RESPONSES, block: REQUESTS});
  }

  function is401(response) {
    return response.name === "401 Credential compromised";
  }

  function isCreated(response, zone) {
    // Accept the contract's zone notation whether or not it prints parentheses.
    return new RegExp("^201 Created \\(?" + zone + "\\)?$").test(response.name);
  }

  function evictedZone(response) {
    // The capacity branch names the workspace that was invalidated.
    return response.name.indexOf("Capacity eviction(A)") >= 0 ? "A" : "B";
  }

  function reportedPrefix(response) {
    // Status responses end in the confirmed prefix (0, 1, or 2).
    var match = /([012])\s*$/.exec(response.name);
    return match ? Number(match[1]) : 0;
  }

  function forgetEpoch() {
    // Rotation invalidates both ordinary workspaces, regardless of prior work.
    validA = false; validB = false;
    prefixA = 0; prefixB = 0;
  }

  while (true) {
    if (compromised) {
      var rotation = requestThenObserve("POST /credentials/rotate");
      if (rotation.name === "200 Rotated") {
        compromised = false;
        forgetEpoch();
      }
      continue;
    }

    if (!validA || !validB) {
      var createZone = !validA ? "A" : "B";
      var created = requestThenObserve("POST /mitigation/" + createZone);
      if (is401(created)) {
        compromised = true;
      } else if (isCreated(created, createZone)) {
        if (createZone === "A") { validA = true; prefixA = 0; }
        else { validB = true; prefixB = 0; }
      }
      // A 503 is the single flood branch: keep this workspace invalid and retry.
      continue;
    }

    var zone = prefixA < 2 ? "A" : (prefixB < 2 ? "B" : "");
    if (zone !== "") {
      var stage = zone === "A" ? prefixA + 1 : prefixB + 1;
      var stageResult = requestThenObserve("PUT /mitigation/" + zone + "/stage/" + stage);

      if (stageResult.name === "204 Applied") {
        if (zone === "A") { prefixA = stage; } else { prefixB = stage; }
      } else if (is401(stageResult)) {
        compromised = true;
      } else if (stageResult.name === "504 Edge timeout") {
        // Resolve the one ambiguous operation before issuing another stage.
        var status = requestThenObserve("GET /mitigation/" + zone + "/status");
        if (is401(status)) {
          compromised = true;
        } else if (zone === "A") {
          prefixA = reportedPrefix(status);
        } else {
          prefixB = reportedPrefix(status);
        }
      } else if (stageResult.name.indexOf("409 Capacity eviction") === 0) {
        var victim = evictedZone(stageResult);
        // The requested stage was not applied; only the named victim is lost.
        if (victim === "A") { validA = false; prefixA = 0; }
        else { validB = false; prefixB = 0; }
      }
      continue;
    }

    var reopened = requestThenObserve("POST /traffic/reopen");
    if (reopened.name === "201 Traffic reopened") {
      return; // Terminal success: issue no further requests.
    }
    if (is401(reopened)) {
      compromised = true;
    } else {
      // Defensive legal-branch handling for an unsafe reopen: rebuild certainty.
      forgetEpoch();
    }
  }
});
