# Provengo counterexample, call 1

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
200 A Prefix(1)
PUT /mitigation/A/stage/2
409 Capacity eviction(B)
POST /mitigation/B
201 Created (B)
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/A/stage/2
204 Applied
PUT /mitigation/A/stage/2
VIOLATION OCCURS IN THIS STATE
```
