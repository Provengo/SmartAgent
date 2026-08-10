# Frozen blind prompt: checkpoint recovery

The agent was denied repository context, skills, Provengo, formal verification, prior solutions, and subagents. It received the following complete contract.

A client must upload a four-chunk backup. It controls requests and observes all responses; the server may choose any response allowed below.

Requests: create session; upload chunks 1–4; checkpoint; restore; commit; refresh authentication.

1. Session creation returns `201` or `503`; `503` may occur once globally.
2. A chunk upload returns `204` or `401`.
3. Authentication expiry may start once. After the first `401`, every protected request returns `401` until refresh.
4. Refresh always succeeds, advances authentication generation, and invalidates ordinary older sessions.
5. Checkpoint on a valid session records its contiguous uploaded prefix. One checkpoint exists and remains restorable after refresh.
6. Restore after refresh creates a valid current-generation session containing exactly the checkpointed prefix; without a checkpoint it returns `409`.
7. Direct retry without refresh continues returning `401`.
8. Commit succeeds only when chunks 1–4 are present in one valid current-generation session.
9. Success must occur within 12 requests.

The agent was asked for a causal winning strategy and complete worst-case request count using ordinary reasoning only.
