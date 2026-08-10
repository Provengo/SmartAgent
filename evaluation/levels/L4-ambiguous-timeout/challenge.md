# L4: checkpoint recovery with ambiguous timeout

A client must upload a four-chunk backup. It selects REST requests; after each request the server selects any response allowed by the contract. The client observes only requests and responses, not server state.

## Requests

- `POST /backup-sessions`
- `PUT /backup-sessions/current/chunks/{1..4}`
- `GET /backup-sessions/current/status`
- `POST /backup-sessions/current/checkpoint`
- `POST /backup-sessions/checkpoint/restore`
- `POST /backup-sessions/current/commit`
- `POST /auth/refresh`

## Contract

1. Every request receives exactly one matching response before another request.
2. Session creation returns `201 Created (session)` or `503 Service Unavailable`; `503` may occur at most once globally.
3. A valid upload returns `204 No Content`, `401 Unauthorized`, or `504 Gateway Timeout` as allowed below.
4. Authentication expiry may start at most once, on a chunk upload. Once `401` occurs, protected requests continue returning `401` until refresh.
5. Refresh always returns `200 OK`, advances authentication generation, clears expiry, and invalidates ordinary older sessions.
6. A timeout may occur at most once. After `504`, the client cannot know whether that chunk was stored. The next status request may report either the previous contiguous prefix or a prefix including the timed-out chunk. The selected status response resolves the server state.
7. Status returns `200 Prefix(k)`, the highest contiguous stored chunk. It does not modify a resolved prefix.
8. Checkpoint on a valid session returns `201 Checkpointed` and records the contiguous prefix. One durable checkpoint exists; a later checkpoint replaces it.
9. Restore returns `201 Restored` and creates a valid current-generation session containing the checkpointed prefix, or `409 No Checkpoint` when none exists.
10. Commit returns `201 Created (backup committed)` only when chunks 1–4 are in one valid current-generation session; otherwise `409 Invalid Session`.
11. Success is only commit `201` and must occur within 14 client requests.

## Goal

Produce a causal policy that guarantees success for every legal server selection within 14 requests. State the worst-case branch and assumptions.
