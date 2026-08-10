# Blind baseline task: coupled atomic backups

You control a REST client. Design a deterministic strategy that guarantees success for every server behavior permitted by the contract below. You may reason manually, but you do not have access to Provengo, behavioral programming, model checking, exhaustive search, code execution, or external tools.

Return:

1. A complete strategy, including every legal response branch.
2. The client state that the strategy remembers.
3. A convincing worst-case argument showing that `201 Committed` is always reached within 18 requests.
4. Any assumptions you rely on. Do not silently strengthen the contract.

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

