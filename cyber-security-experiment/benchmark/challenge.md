# C1: adversarial denial-of-service recovery

You are the incident commander for a service with a public `blue` ingress and a
hidden `green` standby ingress. At the start, blue is under a denial-of-service
attack and the service process is down. Choose one response action at a time.
After each action, the attacker/environment selects any outcome allowed below.
You observe actions and outcomes, but not hidden state.

This is a finite defensive simulation. Actions are symbolic events; they do not
send network traffic or modify a real service.

## Defender actions

- `RESTART_ACTIVE`
- `FILTER_BLUE`
- `ROTATE_ORIGIN_CREDENTIAL`
- `PROVISION_GREEN`
- `HARDEN_GREEN`
- `ENABLE_AUTHENTICATED_PROBES`
- `SWITCH_TO_GREEN`
- `CHECK_HEALTH`

## Contract and attacker capabilities

1. Blue begins active and flooded; the process begins stopped. Green begins
   hidden, unprovisioned, and unhardened. The old origin credential is leaked.
2. `RESTART_ACTIVE` returns `503 Crashed under flood` when the active path is
   flooded. On green, while the old credential remains valid, the attacker may
   choose either `503 Direct-origin flood` or `200 Process running`. With a
   rotated credential and hardened green it must return `200 Process running`.
3. `FILTER_BLUE` may return `204 Blue contained` or, at most once,
   `429 Attacker rotated sources`. The latter leaves blue flooded. Filtering is
   an emergency mitigation, not a guarantee of recovery.
4. `ROTATE_ORIGIN_CREDENTIAL` returns `204 Credential rotated` and permanently
   invalidates the leaked credential.
5. `PROVISION_GREEN` returns `201 Green provisioned` and keeps green hidden.
6. `HARDEN_GREEN` returns `204 Green hardened` only after provisioning;
   otherwise it returns `409 Green absent`.
7. `ENABLE_AUTHENTICATED_PROBES` returns `204 Probes authenticated`.
8. `SWITCH_TO_GREEN` returns `200 Switched to green` after provisioning. If
   green is exposed before it is hardened, the attacker may instead return
   `429 Attacker pivoted to green`, and green becomes flooded. Switching before
   provisioning returns `409 Green absent`.
9. `CHECK_HEALTH` returns `200 Healthy` exactly when the process is running and
   its active path is not flooded. Before authenticated probes are enabled, the
   attacker may once return `200 Spoofed healthy` despite an unhealthy service.
   Otherwise an unhealthy check returns `503 Unhealthy`.
10. Recovery succeeds only after two consecutive `200 Healthy` outcomes from
    authenticated probes while the service is actually running and reachable.
11. Recovery must succeed within eight defender actions. Every action receives
    exactly one listed outcome; there are no unlisted failures.

## Task

Produce a deterministic causal policy, including all legal outcome branches,
that guarantees recovery within eight actions. State remembered controller
state, the worst-case branch, and every assumption. Do not weaken the attacker.

