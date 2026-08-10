# Provengo Smart Agent: verified REST recovery

This repository demonstrates an AI-agent workflow for planning a controller against every legal response of a REST server. The benchmark is deliberately direct: controller events are HTTP requests, environment events are HTTP status responses, and the Behavioral Program encodes the API contract without a robotics abstraction layer.

## Live report

[Open the animated Slidev presentation](https://provengo.github.io/SmartAgent/)

The presentation replays both the verifier counterexample and the verified worst-case recovery while showing token generation, session validity, and uploaded chunks.

## Result

| Controller | Provengo result | Meaning |
|---|---:|---|
| Naive: refresh and retry the failed chunk in the old session | 4 violations | A legal late `401` leads to `409 Invalid Session` |
| Repaired: refresh, create a new session, and re-upload all chunks | 0 violations | Successful commit for every legal response sequence |

Provengo verification used DFS depth 24. The longest complete play has 18 events—9 requests and 9 responses—so the bound covers the complete finite benchmark.

## Repository map

- [`skills/provengo-controller-planner/SKILL.md`](skills/provengo-controller-planner/SKILL.md) — reusable agent workflow
- [`rest-backup-challenge.md`](skills/provengo-controller-planner/references/rest-backup-challenge.md) — benchmark prompt and REST contract
- [`runs/rest-backup-naive`](runs/rest-backup-naive) — failing strategy, BProgram, verifier report, and counterexamples
- [`runs/rest-backup-verified`](runs/rest-backup-verified) — repaired strategy, BProgram, and successful verification evidence
- [`report`](report) — Slidev source and interactive traces

## Reproduce verification

The experiment uses the verification-capable Provengo CLI jar built from `C:\Users\geraw\provengo\SeleniumBasedTests`:

```powershell
java -jar 'C:\Users\geraw\provengo\SeleniumBasedTests\target\testory-c1-0.7.5-SNAPSHOT.uber.jar' --batch-mode --no-color verify --max-depth 24 -o 'runs\rest-backup-naive\verification.html' 'runs\rest-backup-naive\rest-backup-controller'

java -jar 'C:\Users\geraw\provengo\SeleniumBasedTests\target\testory-c1-0.7.5-SNAPSHOT.uber.jar' --batch-mode --no-color verify --max-depth 24 -o 'runs\rest-backup-verified\verification.html' 'runs\rest-backup-verified\rest-backup-controller'
```

## Scope of the claim

The result proves the repaired controller against every response sequence allowed by this finite REST contract. It does not prove properties of an external production backup service whose behavior is not represented by the contract.
