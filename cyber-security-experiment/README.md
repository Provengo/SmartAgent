# Model-guided incident response experiment

This directory is an independent, defensive cyber-security experiment. It does
not use the backup benchmark's prompts, runs, results, or report. The simulated
incident is a denial-of-service attack; no traffic is generated and no external
system is contacted.

## Research question

Does an agent with an explicit, executable threat model produce incident-
response policies that withstand every modeled attacker move more often than a
matched agent reasoning from the prose contract alone?

`benchmark/challenge.md` is **C0, a plumbing calibration only**. Its linear
solution is intentionally easy and it must not be used as evidence for a
planning advantage. The preregistered comparison uses
`benchmark/target-challenge.md` (C2). That benchmark deliberately makes
"restart the server" insufficient and couples two recovery zones, durable
response snapshots, credential epochs, ambiguous operations, and capacity
eviction.

The calibration benchmark
attacker may keep flooding the blue ingress, rotate source identities once,
pivot to a prematurely exposed green ingress, use a leaked origin credential,
and spoof one unauthenticated health response. A winning response must prepare a
clean path before exposing it, rotate the origin credential, restart there, and
confirm recovery with authenticated probes.

## Layout

- `benchmark/challenge.md` - C0 calibration; not an experimental endpoint
- `benchmark/target-challenge.md` - C2 target shared by both conditions
- `conditions/baseline-prompt.md` - isolated no-model/no-verifier prompt
- `conditions/guided-prompt.md` - model-guided condition prompt
- `conditions/guided/incident-controller/` - open attacker, controller, and monitors
- `evaluation/PROTOCOL.md` - preregistered comparison and scoring rules
- `evaluation/results.csv` - empty result ledger, one row per fresh trial
- `reports/README.md` - report template and claim discipline
- `runs/` - per-trial artifacts; intentionally empty except for its README

## Reproduce the guided verification

From the repository root:

```powershell
java -jar 'C:\Users\geraw\provengo\SeleniumBasedTests\target\testory-c1-0.7.5-SNAPSHOT.uber.jar' --batch-mode --no-color verify --max-depth 20 -o '..\verification.html' 'cyber-security-experiment\conditions\guided\incident-controller'
```

This command verifies C0 only. The verification result belongs under this directory only. Baseline policies
must be preserved before they are translated into the same open-attacker model.
