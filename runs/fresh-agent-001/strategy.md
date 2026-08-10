# Warehouse corridor controller report

## Status

The controller strategy is implemented and the reachable graph was exhaustively generated to depth 20 by `provengo analyze` (53 states, 71 edges). The installed Provengo CLI 0.7.5-SNAPSHOT exposes no formal verification/FM subcommand, so the guarantee is **not claimed as formally verified**. Formal verification capability is the only blocker.

## Game contract and assumptions

- The trace starts with one system event and alternates with exactly one environment event.
- The controller observes selected events only. It requests one prescribed system move; the open environment requests every legal response.
- Winning means legal, collision-free `Deliver` at `GOAL` no later than system event 9 on every maximal play.
- Initial state: robot at `STAGING`, no permit, no denial/recall used, and no forklift in either corridor. The benchmark explicitly states only the robot location; the empty forklift state is inferred from `ForkliftEnter(c)` being the operation that *places* it. If arbitrary hidden initial occupancy were allowed, the prompt would need an initial observation because a request to an occupied corridor can create a mandatory-response deadlock after the one denial.
- No fairness assumption is added.

## Causal strategy

1. `Request(NORTH)`.
2. If denied, immediately `Request(NORTH)` again. Since denial is allowed at most once and NORTH is initially empty, the second response must be `Grant(NORTH)`.
3. After a grant, immediately `Enter(NORTH)`, then `Advance(NORTH)`, `Exit(NORTH)`, and `Deliver`.

The grant-first branch uses 5 system events; the deny-first branch uses 6. Recall cannot defeat the policy: the mandatory `Grant` is itself the environment response, and the next system event is immediate entry, after which recall is forbidden. While the robot is inside NORTH, the environment retains all legal choices (`NoChange` and applicable SOUTH forklift movement), but cannot place the forklift in NORTH before exit.

## Separation and traceability

| Rule(s) | Enforcing b-thread / check |
|---|---|
| 1 | `Candidate controller`, `Open dispatcher`, and `Monitor` explicitly block the opposite owner's events at each turn |
| 2-7, 10-13 | `Open dispatcher and domain transition model` legality assertions and construction of the complete legal response array |
| 3, 6 | `denies` and `recalls` counters in the open dispatcher |
| 8, 11, 12, 15 | permit/location/forklift transitions plus collision assertion in the open dispatcher |
| 9 | phase checks enforce `Enter -> Advance -> Exit`; the candidate supplies eventual progress |
| 14 | domain assertion permits `Deliver` only at `GOAL` |
| 16 and bounded reachability | independent `Monitor - legal alternation and delivery by system event 9` |

The controller is separate from environment/domain state and branches only on the observed grant/deny event. Environment options were not removed to suppress losing traces.

## Commands actually run and evidence

CLI discovery:

```text
provengo --help
provengo run --help
provengo analyze --help
provengo create --help
provengo sample --help
provengo ensemble --help
provengo --version
```

Observed version: `0.7.5-SNAPSHOT`. Top-level commands were only `run, analyze, gen-scripts, report, sample, ensemble, gen-book, create`; none is formal verification/FM. `analyze` describes generation of a test-space map, so it is retained only as structural evidence and not relabeled verification.

Successful graph command:

```text
provengo --batch-mode --no-color analyze -f json --max-depth 20 -o C:\Users\geraw\provengo\SmartAgent\runs\fresh-agent-001\analysis.json C:\Users\geraw\provengo\SmartAgent\runs\fresh-agent-001\warehouse-controller
```

Unedited result summary:

```text
19:33:14.604 INFO [ANALYZE] Max DFS depth: 20
19:33:15.554 INFO [ANALYZE] Found 53 states, connected by 71 edges.
19:33:15.607 INFO [ANALYZE] output C:\Users\geraw\provengo\SmartAgent\runs\fresh-agent-001\analysis.json
```

Independent JSON graph audit command inspected terminal and invalid nodes with PowerShell `ConvertFrom-Json`. Output:

```text
nodes=53 edges=71 terminals=1
terminal=nn4a_1 incoming=Deliver statements=0 valid=True
invalid_nodes=0
```

The longest policy branch is 11 total selected events (6 system, 5 environment), below analysis depth 20. This supports model sanity but is not a formal-verifier result.

## Counterexamples and repairs

No formal counterexample trace was available because the installed CLI lacks verification mode. No assertion-invalid node appeared in the analysis graph.

Two execution/setup failures were repaired without changing game semantics:

1. `provengo create ...` required interactive input and failed under the batch shell (`No line found`). The project was scaffolded explicitly using the installed template's documented structure.
2. The first analysis attempts reported an outdated top-level `provengo.yml`, then no source files. The config was moved to `config/provengo.yml` and the model to `spec/js/model.js`; analysis then succeeded.

## Required formal verification

To substantiate “verified for every legal environment choice within 9 system events,” install a Provengo distribution/component that exposes its BPjs DFS formal verification/FM command, run it against the assertions in this project, preserve its explored state count and counterexample trace (if any), repair only the classified fault, and rerun all properties. Sampling, `run`, and `analyze` are intentionally not substituted.

