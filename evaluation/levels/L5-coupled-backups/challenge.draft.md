# L5 draft: coupled atomic backups

Two backups, `A` and `B`, must be uploaded and committed atomically. The client controls REST requests; the server selects any response allowed below. The client observes request/response history only.

## Requests

- `POST /sessions/{A|B}`
- `PUT /sessions/{A|B}/chunks/{1|2}`
- `GET /sessions/{A|B}/status`
- `POST /checkpoint-all`
- `POST /restore-all`
- `POST /auth/refresh`
- `POST /commit-all`

## Contract

1. Both sessions must exist before any upload. Chunks for each backup are uploaded in order.
2. Session creation returns `201 Created` or the single globally permitted `503`.
3. A PUT may return `204`, the single expiry-initiating `401`, the single ambiguous `504`, or the single `409 QuotaRebalance(victim)`.
4. After `401`, every protected request returns `401` until refresh. Refresh advances the shared authentication generation and invalidates both ordinary sessions.
5. After `504`, status for that backup may report the previous prefix or a prefix including the timed-out chunk; that response resolves the server state.
6. `QuotaRebalance(victim)` stores no requested chunk and invalidates the named session. The other session and any durable checkpoint remain unchanged.
7. `checkpoint-all` requires both sessions to be valid. It atomically records both confirmed prefixes in one durable checkpoint that survives refresh and quota rebalance.
8. `restore-all` creates two valid current-generation sessions from the durable checkpoint, or returns `409 No Checkpoint`.
9. `commit-all` returns `201 Committed` only when both current-generation sessions contain chunks 1 and 2. No partial commit is success.
10. The `503`, `401`, `504`, and quota rebalance may each occur at most once, independently.
11. The client must reach `201 Committed` within 18 requests.

## Candidate invariant to verify, not part of the baseline prompt

Create both sessions, establish prefix 1 for both, and checkpoint them together. Before that checkpoint, repair a quota victim individually and restart both after authentication refresh. After the checkpoint, use `restore-all` after either cross-session invalidation, then replay the second chunks. Resolve every timeout by status before advancing.
