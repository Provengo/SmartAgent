# Cyber experiment report

## Executive result

Pending preregistered trials. Do not copy results from the REST backup study.
C0 calibration results must be labeled separately and excluded from claims of a
planning advantage. The primary table is C2 only.

## Required tables

1. Trial-level outcomes from `../evaluation/results.csv`.
2. Pass rate and confidence interval by condition.
3. Failure taxonomy: restart loop, source-rotation miss, premature green
   exposure, leaked-origin miss, spoofed-health trust, or bound overrun.
4. Verification coverage and exact command/version.

## Interpretation template

State separately whether the guided policy was verified, whether baseline and
guided pass rates differ, and whether the evidence supports a planning benefit
or only an assurance/coverage benefit. The model proves claims only for the
finite attacker contract, not for real-world denial-of-service attacks.

Do not write "only the smart agent can solve it" from one comparison. The
supported phrasing, if the preregistered threshold is met, is: "under the tested
conditions, model-guided agents achieved a higher verified-policy pass rate."
