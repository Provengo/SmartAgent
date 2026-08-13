Design a deterministic causal incident-response controller for
`target-challenge.md` and write the final controller to `strategy.js` using
`neutral-controller-interface.md`.

You have Provengo and the `provengo-controller-planner` skill. Read the complete
skill first. Build/use the supplied executable development model with its open
attacker and monitors. Iteratively run formal `verify`, inspect legal
counterexamples, and repair the controller without weakening the environment or
bound. Stop only when verification passes or after five synthesis turns.
Preserve development commands, verifier logs, reports, and candidate history.
