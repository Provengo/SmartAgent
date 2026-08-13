The candidate was rejected by the advertised BPjs snapshot-compatibility gate
before behavioral evaluation. Rewrite `controller.js` to satisfy the mandatory
interface rules exactly: one b-thread, no nested helpers, primitive `var` state,
no regular expressions, arrays, stored objects, closures, or arrow functions.
Preserve the intended strategy. This is an artifact-format correction; no
Provengo behavioral result or counterexample is being provided.
