/* Warehouse corridor adversarial controller benchmark. */

const C = { NORTH: "NORTH", SOUTH: "SOUTH" };
function E(name) { return bp.Event(name); }
function Request(c) { return E("Request(" + c + ")"); }
function Grant(c) { return E("Grant(" + c + ")"); }
function Deny(c) { return E("Deny(" + c + ")"); }
function Recall(c) { return E("Recall(" + c + ")"); }
function Enter(c) { return E("Enter(" + c + ")"); }
function Advance(c) { return E("Advance(" + c + ")"); }
function Exit(c) { return E("Exit(" + c + ")"); }
function Cancel(c) { return E("Cancel(" + c + ")"); }
function ForkliftEnter(c) { return E("ForkliftEnter(" + c + ")"); }
function ForkliftLeave(c) { return E("ForkliftLeave(" + c + ")"); }
const Wait = E("Wait"), NoChange = E("NoChange"), Deliver = E("Deliver");

const allSystem = bp.EventSet("all system events", e =>
  /^(Request|Enter|Advance|Exit|Cancel)\((NORTH|SOUTH)\)$/.test(e.name) ||
  e.name === "Wait" || e.name === "Deliver");
const allEnvironment = bp.EventSet("all environment events", e =>
  /^(Grant|Deny|Recall|ForkliftEnter|ForkliftLeave)\((NORTH|SOUTH)\)$/.test(e.name) ||
  e.name === "NoChange");

/* Candidate controller: causal and based only on selected event history. */
bthread("Candidate controller - request NORTH and traverse immediately", function () {
  bp.sync({request: Request(C.NORTH), block: allEnvironment});
  let response = bp.sync({waitFor: [Grant(C.NORTH), Deny(C.NORTH)], block: allSystem});
  if (response.name === Deny(C.NORTH).name) {
    bp.sync({request: Request(C.NORTH), block: allEnvironment});
    bp.sync({waitFor: Grant(C.NORTH), block: allSystem});
  }
  bp.sync({request: Enter(C.NORTH), block: allEnvironment});
  bp.sync({waitFor: allEnvironment, block: allSystem});
  bp.sync({request: Advance(C.NORTH), block: allEnvironment});
  bp.sync({waitFor: allEnvironment, block: allSystem});
  bp.sync({request: Exit(C.NORTH), block: allEnvironment});
  bp.sync({waitFor: allEnvironment, block: allSystem});
  bp.sync({request: Deliver, block: allEnvironment});
});

/* Open environment and domain story state. Every legal response is requested. */
bthread("Open dispatcher and domain transition model", function () {
  let location = "STAGING", permit = null, forklift = null;
  let denies = 0, recalls = 0, pendingRequest = null, phase = null;
  while (true) {
    let s = bp.sync({waitFor: allSystem, block: allEnvironment});
    if (s.name.indexOf("Request(") === 0) {
      bp.ASSERT(location === "STAGING" && permit === null, "illegal Request");
      pendingRequest = s.name.indexOf("NORTH") >= 0 ? C.NORTH : C.SOUTH;
    } else if (s.name.indexOf("Enter(") === 0) {
      let c = s.name.indexOf("NORTH") >= 0 ? C.NORTH : C.SOUTH;
      bp.ASSERT(location === "STAGING" && permit === c && forklift !== c, "illegal Enter");
      location = c; phase = "ENTRANCE";
    } else if (s.name.indexOf("Advance(") === 0) {
      let c = s.name.indexOf("NORTH") >= 0 ? C.NORTH : C.SOUTH;
      bp.ASSERT(location === c && phase === "ENTRANCE", "illegal Advance");
      phase = "FAR";
    } else if (s.name.indexOf("Exit(") === 0) {
      let c = s.name.indexOf("NORTH") >= 0 ? C.NORTH : C.SOUTH;
      bp.ASSERT(location === c && phase === "FAR", "illegal Exit");
      location = "GOAL"; phase = null; permit = null;
    } else if (s.name.indexOf("Cancel(") === 0) {
      let c = s.name.indexOf("NORTH") >= 0 ? C.NORTH : C.SOUTH;
      bp.ASSERT(location === "STAGING" && permit === c, "illegal Cancel");
      permit = null;
    } else if (s.name === "Wait") {
      bp.ASSERT(location === "STAGING" || location === "GOAL", "illegal Wait");
    } else if (s.name === "Deliver") {
      bp.ASSERT(location === "GOAL", "illegal Deliver");
      break;
    }

    let legal = [];
    if (pendingRequest !== null) {
      if (forklift !== pendingRequest) legal.push(Grant(pendingRequest));
      if (denies < 1) legal.push(Deny(pendingRequest));
    } else {
      legal.push(NoChange);
      if (location === "STAGING" && permit !== null && recalls < 1) legal.push(Recall(permit));
      [C.NORTH, C.SOUTH].forEach(c => {
        if (forklift === c) legal.push(ForkliftLeave(c));
        if (forklift === null && permit !== c && location !== c) legal.push(ForkliftEnter(c));
      });
    }
    bp.ASSERT(legal.length > 0, "environment has no legal response");
    let env = bp.sync({request: legal, block: allSystem});
    if (env.name.indexOf("Grant(") === 0) {
      permit = pendingRequest; pendingRequest = null;
    } else if (env.name.indexOf("Deny(") === 0) {
      denies++; pendingRequest = null;
    } else if (env.name.indexOf("Recall(") === 0) {
      recalls++; permit = null;
    } else if (env.name.indexOf("ForkliftEnter(") === 0) {
      forklift = env.name.indexOf("NORTH") >= 0 ? C.NORTH : C.SOUTH;
    } else if (env.name.indexOf("ForkliftLeave(") === 0) {
      forklift = null;
    }
    bp.ASSERT(!(location === forklift), "collision");
  }
});

/* Independent bounded-reachability and alternation monitor. */
bthread("Monitor - legal alternation and delivery by system event 9", function () {
  let systemCount = 0;
  while (true) {
    let s = bp.sync({waitFor: allSystem, block: allEnvironment});
    systemCount++;
    bp.ASSERT(systemCount <= 9, "more than 9 system events");
    if (s.name === "Deliver") return;
    bp.sync({waitFor: allEnvironment, block: allSystem});
    if (systemCount === 9) bp.ASSERT(false, "delivery not reached by system event 9");
  }
});

