# Two-agent Provengo/CEGIS evaluation protocol

## Research question

Does a Codex agent with Provengo and counterexample-guided repair produce a
controller that passes an independent formal evaluator more reliably than a
matched Codex agent using its ordinary tools without Provengo?

## One matched pair

Run two fresh, independent agents with the same model, reasoning effort, frozen
challenge, neutral controller interface, and initial output requirements.

### Agent 1: ordinary Codex

- Has the ordinary Codex filesystem/shell/reasoning tools available in its
  isolated workspace.
- Has no Provengo executable, Provengo model, verifier output, counterexample,
  `provengo-controller-planner` skill, repository context, or prior solution.
- Produces one `strategy.js`. It receives no repair opportunity based on formal
  evaluation.

### Agent 2: Provengo + CEGIS

- Has the same ordinary tools plus the `provengo-controller-planner` skill, a
  verification-capable Provengo JAR, and an executable development model.
- May propose a strategy, run `verify`, inspect a counterexample, and repair the
  strategy repeatedly, for at most five agent turns.
- Must not weaken the attacker, monitors, bound, or independent evaluator.
- Produces a final neutral `strategy.js` in the same interface as Agent 1.

## Independent evaluation applied to both agents

After each agent finishes, a separate fixed evaluator combines its
`strategy.js` byte-for-byte with:

- `harness/neutral-runtime.js`;
- `harness/open-attacker.js`;
- the same safety and 20-request reachability monitor;
- all 24 permutations of `503`, `401`, `504`, and `EVICTION`;
- `provengo verify --max-depth 42`.

Agent 1 never sees this result. Agent 2's final external evaluation is distinct
from its development-time verification. A strategy passes only if all 24
external partitions report `No violations found.`

## Isolation and fairness

- Use fresh temporary workspaces with no repository parent context.
- Randomize which agent starts first within each pair.
- Preserve prompts, event logs, candidates, tokens, elapsed time, verifier
  commands, and reports.
- The external evaluator never repairs or translates decisions; the neutral
  runtime adapter only implements `selectRequest` and `observeResponse`.
- Clone-safety restrictions are identical for both final artifacts.
- Tool/infrastructure failures are `UNPROVEN`, distinct from behavioral failure.

Agent 2 necessarily receives more capability and may consume more compute. This
is an evaluation of the complete Provengo/CEGIS workflow, not a claim that
counterexample text alone causes the effect. Report tokens, turns, and wall time
so the cost is explicit.

## Outcomes

Primary outcome per agent: external verifier `PASS` or `FAIL`.

Secondary outcomes:

- Agent 1 counterexample class when it fails;
- number of Agent 2 CEGIS iterations and repaired counterexamples;
- tokens and elapsed time;
- worst-case request count;
- development-verifier result versus independent-evaluator result.

For a case study, one pair where Agent 1 fails externally and Agent 2 passes
supports: “In this benchmark instance, the Provengo/CEGIS workflow produced a
verified strategy while the ordinary agent did not.” Multiple independent pairs
are required for a pass-rate or reliability claim.

## Frozen C2.2 artifacts

Hashes are recorded in `frozen-artifacts.sha256`. Any semantic change creates a
new benchmark version. Earlier paired/self-revision pilots are excluded from the
two-agent primary analysis.

