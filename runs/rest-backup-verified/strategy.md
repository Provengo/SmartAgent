# Verified REST backup strategy

## Causal policy

1. Create a backup session; retry after the server's single permitted `503`.
2. Upload chunk 1, then chunk 2.
3. If either upload returns `401`, refresh authentication, abandon the invalid session, create a new session, and restart from chunk 1.
4. Commit only after both chunks were uploaded to the new current-generation session.

The policy uses only observed HTTP responses. It does not read the server's internal token or session generation.

## Verification

```powershell
java -jar 'C:\Users\geraw\provengo\SeleniumBasedTests\target\testory-c1-0.7.5-SNAPSHOT.uber.jar' --batch-mode --no-color verify --max-depth 24 -o 'runs\rest-backup-verified\verification.html' 'runs\rest-backup-verified\rest-backup-controller'
```

Result:

```text
INFO [VERIFY] Max DFS depth: 24
INFO [VERIFY] No violations found.
```

The longest complete play contains 18 selected events: 9 client requests and 9 server responses. Depth 24 therefore covers every complete play under the finite contract. The worst branch uses the one allowed `503`, returns `401` on chunk 2, and forces a complete restart.

## Contract traceability

| Contract story | Enforcement |
|---|---|
| Request/response alternation | Client and server b-threads block the opposite request class while synchronizing |
| At most one `503` | `outages` state in `Open REST server` |
| At most one `401` | `authFailures` state in `Open REST server` |
| Refresh advances token generation | Refresh branch increments `tokenEpoch` |
| Refresh invalidates old sessions | Commit requires `sessionEpoch === tokenEpoch` |
| Stale uploads may return `204` | Upload branch accepts chunks without restoring session generation |
| Same valid session contains both chunks | `chunk1`, `chunk2`, and session-generation commit guard |
| Success only after commit `201` | Controller terminal assertion and bounded-success monitor |
| At most 9 requests | Bounded-success monitor |
