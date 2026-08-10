# Blind baseline prompt

The agent was instructed not to inspect any repository, files, conversation history, skills, Provengo installation, formal verifier, model checker, or prior solution, and to solve only from this contract using ordinary reasoning.

## Problem supplied to the agent

Design a controller that uploads a two-chunk backup through a REST API. The controller chooses requests; after each request the server may choose any response allowed by the contract. The controller observes the complete request/response history.

Requests: `POST /backup-sessions`, `PUT /backup-sessions/{id}/chunks/1`, `PUT /backup-sessions/{id}/chunks/2`, `POST /backup-sessions/{id}/commit`, and `POST /auth/refresh`.

Responses:

- Creating a session: `201 Created` or `503 Service Unavailable`.
- Uploading a chunk: `204 No Content` or `401 Unauthorized`.
- Refreshing authentication: `200 OK`.
- Committing: `201 Created` if the session is valid and complete, otherwise `409 Invalid Session`.

Contract:

1. Every request receives exactly one matching response before another request.
2. The server may return `503` at most once during the mission.
3. The server may return `401` at most once during the mission.
4. `POST /auth/refresh` always succeeds and advances the authentication generation.
5. Refreshing authentication invalidates every backup session created under an older authentication generation.
6. A chunk upload to an invalidated session may return `204`; that does not make the session valid again.
7. Commit succeeds only if both chunks were uploaded to the same session and that session belongs to the current authentication generation.
8. A `201` response to commit ends the mission successfully.
9. The controller may issue at most 9 requests; otherwise it loses.
10. The controller must not report success without a successful commit response.

Goal: give a causal client strategy that guarantees successful commit within 9 requests for every legal server-response sequence. Explain why it works and count the worst case, without formal verification or Provengo.
