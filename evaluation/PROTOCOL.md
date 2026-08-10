# Preregistered evaluation protocol

## Hypothesis

There exists a complexity level `L*` at which a Provengo-guided agent produces a verifier-passing strategy while an otherwise matched no-Provengo agent produces a strategy with a legal counterexample. Below `L*`, both may solve the task, but only the Provengo workflow produces automated exhaustive evidence for the encoded finite game.

## Unit of comparison

One trial is one fresh agent receiving one frozen REST contract. Conditions use the same model family, reasoning effort, task text, and output requirements. The only treatment difference is access to the `provengo-controller-planner` skill, the verification-capable CLI, and counterexample-guided repair.

## Complexity axes

- number of protocol state variables;
- number and placement of server choice points;
- irreversible cross-resource effects;
- recovery mechanisms and their interaction;
- unobservable outcomes that require later observation;
- number of simultaneously live resources;
- tightness of the request bound.

## Ladder

| Level | Added structure | Status |
|---|---|---|
| L1 | Two chunks; one bounded transient response | Blind baseline passed |
| L2 | Authentication generation invalidates sessions | Blind baseline passed with direct retry |
| L3 | Four chunks; persistent expiry; durable checkpoint/restore; tight bound | Blind baseline passed |
| L4 | L3 plus one ambiguous timeout and an explicit status-observation decision | To freeze and validate |
| L5 | L4 plus two live backup resources sharing authentication and quota state | To freeze and validate |

L4 and L5 contracts and numerical bounds must be committed before any no-skill agent receives them. Provengo may be used beforehand only to reject an unwinnable or incorrectly modeled level. Once a level is committed as winnable, its semantics and bound may not change in response to baseline output.

## Trial procedure

1. Freeze the task prompt and hash/commit it.
2. Confirm that the open environment requests every legal response.
3. Use the guided condition to establish that at least one winning policy exists.
4. Launch fresh, isolated agents with no conversation or repository access.
5. Preserve each first answer before translation or feedback.
6. Encode each frozen strategy without improving it.
7. Evaluate every strategy against the same server BProgram and properties.
8. Record `PASS`, `FAIL`, `UNPROVEN`, or `INVALID`, plus requests, repairs, counterexamples, tokens, and elapsed time when available.

## Primary outcome and threshold

For each level and condition, run at least five independent trials. Define `L*` as the lowest frozen level where the guided pass rate exceeds the baseline pass rate and at least one baseline strategy has a verifier-produced legal counterexample. Report all lower levels and all failed attempts; do not present a single favorable trial as the threshold.

## Stopping rule

Stop after L5 or after observing a stable separation over two adjacent levels. If no separation appears, report that the tested range did not support the planning-performance claim.

## Claims discipline

“Verified” means complete exploration of the stated finite bound with no violation. “Without Provengo we cannot be sure” is reported more narrowly as: the baseline workflow supplied no automated exhaustive coverage evidence. Manual proof and other formal tools remain possible alternatives.
