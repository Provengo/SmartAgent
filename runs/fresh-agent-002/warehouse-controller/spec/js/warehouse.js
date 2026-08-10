// Warehouse corridor adversarial game benchmark.
// The game engine is the domain model. Strategy and open-environment move
// generation are kept as separate pure modules below.

const C = ["NORTH", "SOUTH"];
const E = name => bp.Event(name);

function initialState() {
  return {
    turn: "SYSTEM", location: "STAGING", phase: "STAGING",
    permit: null, forklift: null, denies: 0, recalls: 0,
    systemCount: 0, delivered: false, lastSystem: null
  };
}

// Candidate controller: causal and history-observable. It deliberately uses
// no hidden state: every field consulted is derivable from selected events.
function controllerMove(s) {
  if (s.location === "GOAL") return "Deliver";
  if (s.phase === "ENTRANCE") return `Advance(${s.location})`;
  if (s.phase === "FAR_END") return `Exit(${s.location})`;
  if (s.permit !== null) return `Enter(${s.permit})`;
  return "Request(NORTH)";
}

// Open adversarial environment: all and only legal responses are returned.
function environmentMoves(s) {
  const m = [];
  const req = /^Request\((NORTH|SOUTH)\)$/.exec(s.lastSystem || "");
  if (req) {
    const c = req[1];
    if (s.forklift !== c) m.push(`Grant(${c})`);
    if (s.denies < 1) m.push(`Deny(${c})`);
    return m;
  }
  m.push("NoChange");
  if (s.location === "STAGING" && s.permit && s.recalls < 1)
    m.push(`Recall(${s.permit})`);
  for (let i = 0; i < C.length; i++) {
    let corridor = C[i];
    if (s.forklift === corridor) m.push(`ForkliftLeave(${corridor})`);
    if (s.forklift === null && s.permit !== corridor && s.location !== corridor)
      m.push(`ForkliftEnter(${corridor})`);
  }
  return m;
}

function applySystem(s, n) {
  s.systemCount++;
  s.lastSystem = n;
  let x;
  if ((x = /^Request\((.+)\)$/.exec(n))) { /* response updates state */ }
  else if ((x = /^Enter\((.+)\)$/.exec(n))) {
    s.location = x[1]; s.phase = "ENTRANCE";
  } else if ((x = /^Advance\((.+)\)$/.exec(n))) s.phase = "FAR_END";
  else if ((x = /^Exit\((.+)\)$/.exec(n))) {
    s.location = "GOAL"; s.phase = "GOAL"; s.permit = null;
  } else if ((x = /^Cancel\((.+)\)$/.exec(n))) s.permit = null;
  else if (n === "Deliver") s.delivered = true;
  s.turn = "ENVIRONMENT";
}

function applyEnvironment(s, n) {
  let x;
  if ((x = /^Grant\((.+)\)$/.exec(n))) s.permit = x[1];
  else if ((x = /^Deny\((.+)\)$/.exec(n))) s.denies++;
  else if ((x = /^Recall\((.+)\)$/.exec(n))) { s.permit = null; s.recalls++; }
  else if ((x = /^ForkliftEnter\((.+)\)$/.exec(n))) s.forklift = x[1];
  else if (/^ForkliftLeave\((.+)\)$/.test(n)) s.forklift = null;
  s.turn = "SYSTEM";
}

bthread("Domain + explicit turn protocol", function () {
  const s = initialState();
  while (!s.delivered) {
    if (s.turn === "SYSTEM") {
      let systemName = controllerMove(s);
      bp.ASSERT(s.systemCount < 9,
        `BOUNDED_REACHABILITY_FAILURE: no delivery after 9 system events; next=${systemName}`);
      let systemEvent = E(systemName); request(systemEvent); applySystem(s, systemName);
    } else {
      let legal = environmentMoves(s);
      bp.ASSERT(legal.length > 0, "NON_GOAL_DEADLOCK: environment has no legal response");
      let environmentEvent = bp.sync({request: legal.map(E)});
      applyEnvironment(s, environmentEvent.name);
    }
    bp.ASSERT(!(C.includes(s.location) && s.forklift === s.location),
      "SAFETY_FAILURE: robot/forklift collision");
  }
  bp.ASSERT(s.systemCount <= 9, "BOUND_FAILURE");
});

// Independent trace monitor: validates alternation and terminal legality.
bthread("Legality, safety, deadlock, and bounded-goal monitor", function () {
  let count = 0, atGoal = false;
  while (true) {
    let systemObserved = waitFor(any(/^(Request|Wait|Enter|Advance|Exit|Cancel|Deliver)/));
    let observedName = systemObserved.name;
    count++;
    bp.ASSERT(count <= 9, `BOUND_FAILURE: system event ${count} is ${observedName}`);
    if (/^Exit\(/.test(observedName)) atGoal = true;
    if (observedName === "Deliver") {
      bp.ASSERT(atGoal, "LEGALITY_FAILURE: Deliver away from GOAL");
      break;
    }
    waitFor(any(/^(Grant|Deny|Recall|NoChange|ForkliftEnter|ForkliftLeave)/));
  }
});
