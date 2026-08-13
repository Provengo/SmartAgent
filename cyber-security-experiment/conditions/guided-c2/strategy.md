# C2 candidate strategy and verification record

The controller tracks confirmed mitigation prefixes for zones A and B, the
durable snapshot prefixes, whether credential compromise has occurred, and the
zone whose last stage timed out ambiguously. It never reads server state.

It creates both workspaces, reaches prefix 1 in both, snapshots that coupled
state, then completes both zones. A `504` is always resolved by status. A `401`
causes credential rotation followed by restore when a snapshot exists, or full
recreation otherwise. After capacity eviction, the controller compares the
cost of restoring (which discards post-snapshot progress in both zones) with
recreating only the victim, and chooses the cheaper recovery.

Verification evidence is recorded only after the unrestricted open-attacker
model passes the complete request bound.
