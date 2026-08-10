# SLURM calibration results

Five identical L4 Provengo verification jobs ran concurrently on five explicitly distinct CPU nodes. Every job used DFS depth 28 and returned `No violations found`.

| Job | Array task | Node | Elapsed seconds | Result |
|---:|---:|---|---:|---|
| 20006949 | 0 | ise-cpu-intl-04 | 235 | PASS |
| 20006950 | 1 | ise-cpu-intl-05 | 202 | PASS |
| 20006951 | 2 | ise-cpu-intl-06 | 229 | PASS |
| 20006952 | 3 | ise-cpu-intl-16 | 277 | PASS |
| 20006953 | 4 | ise-cpu-intl-17 | 297 | PASS |

The jobs started together and completed within approximately five minutes of wall-clock time. Their summed compute time was 1,240 seconds (20 minutes 40 seconds).

The initial array request used `--exclusive` and remained pending because no CPU node was completely idle. It was cancelled before execution and replaced by five jobs pinned to different nodes, each requesting two CPUs and 4 GiB RAM.
