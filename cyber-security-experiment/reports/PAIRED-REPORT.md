# Paired CEGIS report

## Assurance result

Report `FIRST_PASS / evaluable first candidates`. These strategies did not need
repair, but Provengo supplied exhaustive evidence for the finite C2 model.

## Repair result

Report `CEGIS_REPAIRED / initial behavioral failures`, with exact numerators and
denominators. For each repaired case, show the initial counterexample, the
agent's state/policy change, and the final 24/24 verification result.

## Case-study claim

At least one repaired trajectory permits: “A Provengo-generated counterexample
helped the same agent transform an initially failing controller into a formally
verified controller.”

Do not combine invalid artifacts with behavioral failures, and do not describe
formal verification of the finite model as proof against unmodeled real-world
attacks.
