# Provengo counterexample, call 2

Violated assertion:

`BOUNDED_REACHABILITY_FAILURE: more than 20 requests`

Ordered trace:

```text
POST /mitigation/A
503 Control-plane flood
POST /mitigation/A
201 Created (A)
POST /mitigation/B
201 Created (B)
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
POST /mitigation/A
201 Created (A)
POST /mitigation/B
201 Created (B)
PUT /mitigation/A/stage/1
504 Edge timeout
GET /mitigation/A/status
200 A Prefix(0)
PUT /mitigation/A/stage/1
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/B/stage/1
409 Capacity eviction(A)
POST /mitigation/A
201 Created (A)
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
