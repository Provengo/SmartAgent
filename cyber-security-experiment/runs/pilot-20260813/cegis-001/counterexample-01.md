# Provengo counterexample, call 1

Violated assertion:

`BOUNDED_REACHABILITY_FAILURE: more than 20 requests`

Ordered trace:

```text
POST /mitigation/A
201 Created (A)
POST /mitigation/B
503 Control-plane flood
POST /mitigation/B
201 Created (B)
POST /response-snapshot
201 Snapshotted
PUT /mitigation/A/stage/1
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/B/stage/1
204 Applied
PUT /mitigation/B/stage/2
401 Credential compromised
POST /credentials/rotate
200 Rotated
POST /response-snapshot/restore
201 Restored
PUT /mitigation/A/stage/1
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/B/stage/1
504 Edge timeout
GET /mitigation/B/status
200 B Prefix(1)
PUT /mitigation/B/stage/2
409 Capacity eviction(B)
POST /response-snapshot/restore
201 Restored
PUT /mitigation/A/stage/1
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/B/stage/1
204 Applied
PUT /mitigation/B/stage/2
204 Applied
POST /traffic/reopen
VIOLATION OCCURS IN THIS STATE
```
