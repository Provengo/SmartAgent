# REST backup controller challenge

Design a controller that uploads a two-chunk backup through the following REST API. The controller selects HTTP request events. After every request, the server environment selects any response allowed by the contract. The controller observes the complete request/response history.

## Requests controlled by the client

- `POST /backup-sessions`
- `PUT /backup-sessions/{id}/chunks/1`
- `PUT /backup-sessions/{id}/chunks/2`
- `POST /backup-sessions/{id}/commit`
- `POST /auth/refresh`

## Responses controlled by the server

- Creating a session returns `201 Created` or `503 Service Unavailable`.
- Uploading a chunk returns `204 No Content` or `401 Unauthorized`.
- Refreshing authentication returns `200 OK`.
- Committing returns `201 Created` when the session is valid and complete, otherwise `409 Invalid Session`.

## Contract stories

1. Every request is followed by exactly one matching legal response before another request.
2. The server may return `503` at most once during the mission.
3. The server may return `401` at most once during the mission.
4. `POST /auth/refresh` always succeeds and advances the authentication generation.
5. Refreshing authentication invalidates every backup session created under an older authentication generation.
6. A chunk upload to an invalidated session may return `204`; that response does not make the session valid again.
7. Commit succeeds only when both chunks were uploaded to the same session and that session belongs to the current authentication generation.
8. A successful `201 Created` response to commit ends the mission.
9. The controller may issue at most 9 requests. If commit has not succeeded by then, the mission is lost.
10. The controller must never report success after `409`, after a failed request, or without a successful commit response.

## Goal

Create a causal request strategy that guarantees a successful commit within 9 requests for every legal sequence of server responses. Translate the contract into a Provengo BProgram, encode the controller separately from the open server response generator, and use Provengo formal verification. Preserve a failing counterexample for an initially plausible strategy, repair the strategy rather than restricting server behavior, and verify the repaired policy.

## Required evidence

- Provengo projects for the plausible initial policy and repaired policy;
- exact verification commands and unedited result summaries;
- the failing server-selected trace;
- a concise causal strategy and worst-case request count;
- contract-story traceability and an explicit bounded-verification claim.
