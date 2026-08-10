# L4 blind baseline trials

All five agents received the frozen contract after commit `041e13e`. They had no repository, skill, Provengo, verifier, prior-answer, or inter-agent access.

| Trial | First-answer policy | Claimed bound | Preliminary classification |
|---:|---|---:|---|
| 1 | Checkpoint prefix 2; query after 504; restart before checkpoint, restore after it | 14 | ARGUED_PASS |
| 2 | Same; additionally performs one status query even if no timeout occurred | 14 | ARGUED_PASS |
| 3 | Same; tries restore without a checkpoint, observes 409, then creates a session | 14 | ARGUED_PASS |
| 4 | Checkpoint prefix 2; standard restart/restore split | 14 | ARGUED_PASS |
| 5 | Checkpoint prefix 2; standard restart/restore split | 14 | ARGUED_PASS |

Every answer explicitly handled `201/503`, `204/401/504`, both timeout outcomes, refresh invalidation, checkpoint availability, restore, and the request bound. Formal encodings remain required before changing these rows to `PASS`.

## Shared worst-case trace

```text
Create -> 503
Create -> 201
PUT 1 -> 204
PUT 2 -> 401
Refresh -> 200
Create -> 201
PUT 1 -> 204
PUT 2 -> 204
Checkpoint -> 201
PUT 3 -> 204
PUT 4 -> 504
GET status -> Prefix(3)
PUT 4 -> 204
Commit -> 201
```

Trial 3 used a different but still bounded early-expiry recovery: `restore -> 409 -> create` rather than selecting create directly when no checkpoint existed.
