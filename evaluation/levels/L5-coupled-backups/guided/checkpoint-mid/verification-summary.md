# L5 guided verification summary

## Result

The checkpoint-at-prefix-1 strategy passed exhaustive verification to depth 36, corresponding to the complete 18-request bound: **no violations were found**.

The unrestricted search demonstrated the state-space growth directly:

| Maximum depth | Outcome | Wall time |
|---:|---|---:|
| 12 | No violations (smoke only) | 17 s |
| 20 | No violations | 257 s |
| 24 | No violations | 983 s |
| 28 | Verification exhausted 4 GB; no verdict | 1,246 s |

Depths 32 and 36 of the unrestricted run were cancelled after the depth-28 memory result. They are not counted as evidence of correctness.

## Exhaustive partition argument

For the complete proof, the environment was partitioned by the relative order of its four globally one-shot disruptions: `503`, `401`, `504`, and `QUOTA`. There are `4! = 24` permutations.

Within a partition, the server may emit the next disruption at any legal opportunity or omit it. Consequently, every legal unrestricted execution is included in at least one partition: list the disruptions that actually occur in their observed order, then extend that sequence arbitrarily to a permutation of all four types. The execution is a trace of that partition. The quota partition retains both possible victims, A and B.

All 24 partitions were checked to depth 36. Each reported `No violations found`. This covers both safety assertions and failure to commit within 18 client requests.

## SLURM execution

- Initial jobs: `20007686` through `20007709`, distributed across `ise-cpu-intl-04`, `05`, `06`, `16`, and `17`.
- 22 partitions completed with 4 GB.
- Orders 02 and 03 exhausted 4 GB without a verdict and were rerun with 16 GB as jobs `20007811` and `20007812` on `ise-cpu-intl-09` and `ise-cpu-intl-24`.
- Successful partition wall times ranged from 7 to 310 seconds.
- Raw verifier output is stored under `evaluation/slurm/results/l5-order-partitions/`.

The generated partitions and their manifest are reproducible with `evaluation/slurm/generate-l5-order-partitions.ps1`.
