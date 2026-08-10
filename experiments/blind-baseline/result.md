# Blind baseline result

The no-skill agent found a winning policy on its first answer. Its frozen policy was encoded afterward against the same open-server contract and checked with the same Provengo CLI and DFS depth as the other controllers.

```text
INFO [VERIFY] Max DFS depth: 24
INFO [VERIFY] No violations found.
```

The policy is also more efficient than the report's restart-after-refresh policy: 6 requests rather than 9 in the worst case.

## Interpretation

This benchmark does not demonstrate an advantage for Provengo-guided planning. The strong bounded assumption “`401` at most once” makes direct retry an obvious winning move and makes authentication refresh unnecessary. A fair report must disclose this result and redesign the contract before claiming comparative advantage.
