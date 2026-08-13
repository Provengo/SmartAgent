# Baseline condition: incident response without an executable model

Use the exact C2 contract in `../benchmark/target-challenge.md`.

You may reason manually, but you do not have access to Provengo, behavioral
programming, model checking, exhaustive search, repository files, previous
trials, or counterexamples.

Return only:

1. a deterministic causal policy covering every legal response branch;
2. the state remembered by the policy;
3. a worst-case proof that recovery occurs within twenty requests;
4. explicit assumptions.

Your first answer is final for evaluation and will be preserved unchanged.
