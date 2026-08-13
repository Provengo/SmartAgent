Implemented the deterministic causal controller in [strategy.js](C:\Users\geraw\AppData\Local\Temp\cyber-c2.2-pair001-provengo\strategy.js).

Formal verification passed: `No violations found` at depth 42. The final policy snapshots confirmed progress, resolves timeouts by status, and restores after expiry/eviction; worst case is 20 requests.

I repaired two legal counterexamples during synthesis: Java-string response comparison and an unnecessary timeout checkpoint. The generated verifier log and counterexample report remain in the workspace.