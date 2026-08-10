# Blind agent response

The agent's first answer proposed never calling `/auth/refresh`, because refresh would invalidate the current session.

1. Create a session. On `503`, retry; the retry must return `201`.
2. Upload chunk 1. On `401`, retry the same request; the retry must return `204`.
3. Upload chunk 2 with the same direct-retry rule.
4. Commit and report success only after commit returns `201`.

It argued that `409` is unreachable: both chunks received `204` in the same session, and the client never changed authentication generation.

Worst case: two create requests, three chunk requests, and one commit request—**6 requests**.

Assumptions it stated: session creation returns an ID; `204` on a valid session records the chunk; authentication generation changes only through the client's refresh request.
