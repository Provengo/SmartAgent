# Naive REST backup strategy

The initial controller creates a session, uploads two chunks, and commits. On `401 Unauthorized` it refreshes authentication and retries only the failed upload in the existing session.

Provengo found four counterexamples at DFS depth 24. A representative late-failure trace is:

```text
POST /backup-sessions                         -> 201 Created (session)
PUT /backup-sessions/current/chunks/1         -> 204 No Content
PUT /backup-sessions/current/chunks/2         -> 401 Unauthorized
POST /auth/refresh                            -> 200 OK (token refreshed)
PUT /backup-sessions/current/chunks/2         -> 204 No Content
POST /backup-sessions/current/commit          -> 409 Invalid Session
```

The strategy violates contract story 5: refresh invalidates sessions created under the older authentication generation. Retrying the failed request is insufficient because the first chunk and the session itself belong to invalid state.

Exact command:

```powershell
java -jar 'C:\Users\geraw\provengo\SeleniumBasedTests\target\testory-c1-0.7.5-SNAPSHOT.uber.jar' --batch-mode --no-color verify --max-depth 24 -o 'runs\rest-backup-naive\verification.html' 'runs\rest-backup-naive\rest-backup-controller'
```
