# Warehouse corridor strategy and verification record

## Game contract and assumptions

- System moves first; exactly one system event and one environment response alternate until `Deliver`, which terminates immediately.
- State is initially `STAGING`, with no permit, no forklift in either corridor, and zero denials/recalls. This is the conservative natural reading of “starts at STAGING”; the benchmark specifies no contrary initial occupancy.
- The controller sees only event-derived state. The environment generator offers every legal response in each environment state.
- Winning claim: safety plus universal bounded reachability (delivery within at most 9 system events).

## Causal strategy

Request `NORTH`. If denied, request `NORTH` again. (A second denial is illegal.) On a grant, immediately `Enter(NORTH)`, then `Advance(NORTH)`, `Exit(NORTH)`, and `Deliver`. A mandatory request response prevents a forklift event between request and grant/deny; immediate entry prevents recall before entry. Worst case: 6 system events (`Request`, denied; `Request`, granted; `Enter`, `Advance`, `Exit`, `Deliver`).

## Exact CLI discovery and verification commands

```powershell
java -jar 'C:\Users\geraw\provengo\SeleniumBasedTests\target\testory-c1-0.7.5-SNAPSHOT.uber.jar' --help
java -jar 'C:\Users\geraw\provengo\SeleniumBasedTests\target\testory-c1-0.7.5-SNAPSHOT.uber.jar' verify --help
java -jar 'C:\Users\geraw\provengo\SeleniumBasedTests\target\testory-c1-0.7.5-SNAPSHOT.uber.jar' --batch-mode --no-color verify --max-depth 20 -o 'C:\Users\geraw\provengo\SmartAgent\runs\fresh-agent-002\verification-repaired.html' 'C:\Users\geraw\provengo\SmartAgent\runs\fresh-agent-002\warehouse-controller'
```

Final unedited summary (full output in `verification-repaired.log`):

```text
20:02:40.922 INFO [VERIFY] Max DFS depth: 20
20:02:51.065 INFO [VERIFY] No violations found.
```

Every play terminates in at most 11 selected events (six system and five environment events), so depth 20 covers the complete finite game. The CLI did not report a state count. It also did not emit an HTML report on the no-violation run despite `-o`; the log is the formal-verification artifact.

## Counterexamples and repairs

1. Initial verifier attempts failed before exploration because its JavaScript engine rejected `for...of`, then function-scoped duplicate `const` declarations. These were compatibility/model errors; repaired with an indexed loop and unique `let` names.
2. The first executable model reported two monitor-property traces: `Request(NORTH), Grant(NORTH)` and `Request(NORTH), Deny(NORTH)`, both ending with `TURN_FAILURE`. Classification: property-monitor error. The catch-all monitor's local expected-turn update interacted incorrectly with this runtime's synchronization semantics. Repair: explicit system-event wait followed by explicit environment-event wait. No environment behavior was restricted; the domain engine continued to generate all legal responses.
3. After repair, all properties were rerun and the verifier reported `No violations found.`

## Story traceability

| Rules | Enforcement |
|---|---|
| 1–2, 13–14 | `Domain + explicit turn protocol`; mandatory request branch; `controllerMove`; terminal loop |
| 3, 6 | `denies`/`recalls` counters in `environmentMoves` and transition updates |
| 4–5 | grant precondition and staging-with-permit environment move generation |
| 7–10 | controller phase transitions and permit-gated immediate entry; corridor phase sequencing |
| 11–12 | forklift occupancy/preconditions in `environmentMoves` |
| 15 | collision assertion after every selected event |
| 16 and goal | system counter assertions plus independent bounded-goal monitor |

## Integrity audit

The open environment requests all legal responses and contains no fairness assumption. The only fixed controller choice is the candidate strategy. Turn state, permits, forklift occupancy, location/phase, denial/recall caps, collision, deadlock, and bounded delivery are represented. No restriction was added merely to eliminate a losing trace.
