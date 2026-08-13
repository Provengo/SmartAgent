# Pilot 001: CEGIS harness validation

## Outcome

| Condition | Call 1 | Final | Calls |
|---|---|---|---:|
| one-shot | Invalid BPjs snapshot state | `INVALID` | 1 |
| self-revision | 24/24 partitions passed | `PASS` | 1 |
| CEGIS | Bound counterexample | `PASS` | 2 |

The CEGIS trajectory demonstrates the intended mechanism: its first controller
exceeded 20 requests on a legal trace, the agent received the canonical trace,
and its repaired second controller passed all 24 order partitions at DFS depth
42. The self-revision controller passed immediately, however, so this pilot does
**not** demonstrate a comparative CEGIS advantage.

## CEGIS counterexample

The first candidate repeatedly restored a snapshot at prefix `(0,0)`. Under the
lowest failing order partition (`503, 401, 504, EVICTION`), recovery after
credential rotation, timeout, and eviction selected request 21. The raw HTML,
verifier output, exact candidate, and feedback text are retained under
`../runs/pilot-20260813/cegis-001/`.

## Integrity notes

- The task/interface/evaluator hashes match `evaluation/frozen-artifacts.sha256`.
- All valid candidates were combined byte-for-byte with the same hidden model.
- The one-shot artifact was not repaired by the evaluator.
- Infrastructure-only failed launches occurred before candidate creation and
  are preserved as `infra-*.jsonl`; they are excluded from trial calls.
- SLURM jobs: self call 1 `20140585`; CEGIS call 1 `20140584`; CEGIS call 2
  `20140832`.

## Next decision

Run the preregistered sample. If self-revision continues to pass on call one at
a high rate, C2 has a ceiling effect and cannot establish the desired treatment
advantage. In that case, report C2 transparently and preregister a harder C3
before running C3 agents; do not alter C2 post hoc.
