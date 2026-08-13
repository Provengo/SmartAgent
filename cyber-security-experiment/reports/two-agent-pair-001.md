# Two-agent experiment: pair 001

## Result

| Agent | Development workflow | Independent external verification |
|---|---|---|
| Ordinary Codex | One strategy; no Provengo or feedback | **FAIL**, violations in 24/24 partitions |
| Provengo + CEGIS | Three verification candidates; two counterexample-driven repairs | **PASS**, 0 violations in 24/24 partitions |

This pair demonstrates the intended case: under the frozen C2.2 task, the
ordinary agent produced a controller rejected by the independent verifier,
while the agent with the Provengo skill and CEGIS produced a controller that
passed the same independent verifier.

## Ordinary-agent failure

The ordinary agent ran in an isolated temporary workspace containing only the
challenge, neutral interface, and ordinary-agent prompt. It had ordinary Codex
tools but no Provengo JAR, skill, executable threat model, verifier result, or
prior solution. Its strategy passed the neutral artifact gate and DFS clone
smoke test, then failed every one of the 24 external order partitions.

The canonical order-00 counterexample violates
`BOUNDED_REACHABILITY_FAILURE: more than 20 requests`: the controller repeatedly
selects `POST /mitigation/A` after successful A creation and never makes bounded
progress. The HTML report is retained as `ordinary-counterexample.html`. This
result was not returned to the ordinary agent.

## Provengo/CEGIS development

The treatment agent received the same challenge and neutral artifact interface,
plus the complete `provengo-controller-planner` skill, verification JAR, open
development attacker, monitors, and a development verification command. Within
one agent session it performed three formal development checks:

1. `Found 3 violation(s)`;
2. after repair, `Found 2 violation(s)`;
3. after a second repair, `No violations found` at depth 42.

The agent reported repairing response comparison and an unnecessary timeout
checkpoint. Its final neutral strategy then passed the independent evaluator's
24 partitions at depth 42. The external evaluator used freshly composed models
and did not rely on the treatment agent's development verdict.

## Cost and scope

| Agent | Recorded model tokens |
|---|---:|
| Ordinary | 150,871 |
| Provengo + CEGIS | 941,340 |

The treatment used substantially more compute and capability; this is a result
for the full Provengo/CEGIS workflow, not an isolated estimate of the causal
effect of counterexample text alone. One matched pair supports a concrete case
study (“the workflow helped here”), not a population-level reliability claim.

The proof covers every behavior encoded by the finite C2.2 attacker contract;
it is not proof against unmodeled production denial-of-service techniques.

## Evidence

- Ordinary external SLURM array: `20141622`
- Provengo-agent external SLURM array: `20141680`
- Both arrays: 24 disruption-order partitions, DFS depth 42
- Frozen hashes: `evaluation/frozen-artifacts.sha256`
- Raw agent event logs, strategies, development log, and external reports:
  `runs/two-agent-primary/pair-001/`
