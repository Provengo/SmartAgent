const E = name => bp.Event(name);
const ACTIONS = any(/^(RESTART_ACTIVE|FILTER_BLUE|ROTATE_ORIGIN_CREDENTIAL|PROVISION_GREEN|HARDEN_GREEN|ENABLE_AUTHENTICATED_PROBES|SWITCH_TO_GREEN|CHECK_HEALTH)$/);
const OUTCOMES = any(/^(200|201|204|409|429|503) /);

// Causal defender: this b-thread reads outcomes, never hidden server state.
bthread("Guided incident controller", function () {
  const plan = [
    "ROTATE_ORIGIN_CREDENTIAL", "PROVISION_GREEN", "HARDEN_GREEN",
    "ENABLE_AUTHENTICATED_PROBES", "SWITCH_TO_GREEN", "RESTART_ACTIVE",
    "CHECK_HEALTH", "CHECK_HEALTH"
  ];
  let observed;
  for (let i = 0; i < plan.length; i++) {
    bp.sync({request:E(plan[i]), block:OUTCOMES});
    observed = bp.sync({waitFor:OUTCOMES, block:ACTIONS});
  }
});

// Open environment. Risky policies expose every attacker choice in the contract.
bthread("Open DoS attacker and service", function () {
  let active="blue", blueFlooded=true, greenFlooded=false, running=false;
  let greenProvisioned=false, greenHardened=false, credentialLeaked=true;
  let probesAuthenticated=false, sourceRotationUsed=false, spoofUsed=false;
  let flooded=false, action, outcome, choices;
  while (true) {
    action = bp.sync({waitFor:ACTIONS, block:OUTCOMES});
    if (action.name.equals("ROTATE_ORIGIN_CREDENTIAL")) {
      outcome=bp.sync({request:E("204 Credential rotated")}); credentialLeaked=false;
    } else if (action.name.equals("PROVISION_GREEN")) {
      outcome=bp.sync({request:E("201 Green provisioned")}); greenProvisioned=true;
    } else if (action.name.equals("HARDEN_GREEN")) {
      outcome=bp.sync({request:E(greenProvisioned ? "204 Green hardened" : "409 Green absent")});
      if (greenProvisioned) greenHardened=true;
    } else if (action.name.equals("ENABLE_AUTHENTICATED_PROBES")) {
      outcome=bp.sync({request:E("204 Probes authenticated")}); probesAuthenticated=true;
    } else if (action.name.equals("FILTER_BLUE")) {
      choices=sourceRotationUsed ? [E("204 Blue contained")] :
        [E("204 Blue contained"),E("429 Attacker rotated sources")];
      outcome=bp.sync({request:choices});
      if (outcome.name.equals("204 Blue contained")) blueFlooded=false;
      else { sourceRotationUsed=true; blueFlooded=true; }
    } else if (action.name.equals("SWITCH_TO_GREEN")) {
      if (!greenProvisioned) outcome=bp.sync({request:E("409 Green absent")});
      else if (!greenHardened) {
        outcome=bp.sync({request:[E("200 Switched to green"),E("429 Attacker pivoted to green")]});
        active="green";
        if (outcome.name.equals("429 Attacker pivoted to green")) greenFlooded=true;
      } else { outcome=bp.sync({request:E("200 Switched to green")}); active="green"; }
    } else if (action.name.equals("RESTART_ACTIVE")) {
      flooded=active.equals("blue") ? blueFlooded : greenFlooded;
      if (flooded) outcome=bp.sync({request:E("503 Crashed under flood")});
      else if (active.equals("green") && credentialLeaked) {
        outcome=bp.sync({request:[E("503 Direct-origin flood"),E("200 Process running")]});
        if (outcome.name.equals("503 Direct-origin flood")) greenFlooded=true;
      } else outcome=bp.sync({request:E("200 Process running")});
      running=outcome.name.equals("200 Process running");
    } else {
      flooded=active.equals("blue") ? blueFlooded : greenFlooded;
      if (running && !flooded) outcome=bp.sync({request:E("200 Healthy")});
      else if (!probesAuthenticated && !spoofUsed) {
        outcome=bp.sync({request:[E("503 Unhealthy"),E("200 Spoofed healthy")]});
        if (outcome.name.equals("200 Spoofed healthy")) spoofUsed=true;
      } else outcome=bp.sync({request:E("503 Unhealthy")});
    }
  }
});

bthread("Bounded genuine recovery monitor", function () {
  let actions=0, consecutiveHealthy=0, authenticated=false;
  let action, outcome;
  while (true) {
    action=bp.sync({waitFor:ACTIONS}); actions++;
    bp.ASSERT(actions<=8,"BOUNDED_RECOVERY_FAILURE: more than eight actions");
    outcome=bp.sync({waitFor:OUTCOMES});
    if (action.name.equals("ENABLE_AUTHENTICATED_PROBES") && outcome.name.equals("204 Probes authenticated")) authenticated=true;
    if (action.name.equals("CHECK_HEALTH") && authenticated && outcome.name.equals("200 Healthy")) consecutiveHealthy++;
    else if (action.name.equals("CHECK_HEALTH")) consecutiveHealthy=0;
    if (actions===8) bp.ASSERT(consecutiveHealthy>=2,
      "BOUNDED_RECOVERY_FAILURE: two genuine healthy checks not reached");
  }
});
