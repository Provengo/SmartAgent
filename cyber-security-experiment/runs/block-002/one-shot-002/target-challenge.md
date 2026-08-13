# C2 target: coupled two-zone DoS recovery

You operate a defensive response API for two service zones, `A` and `B`. Both
zones must be recovered atomically before traffic can be reopened. You select
one request; the attacker/environment selects any response permitted by the
contract. You see requests and responses, not server state. Events are symbolic
and never touch a real network.

## Requests

- `POST /mitigation/{A|B}` — create a zone workspace
- `PUT /mitigation/{A|B}/stage/{1|2}` — apply, in order, origin isolation then adaptive filtering
- `GET /mitigation/{A|B}/status`
- `POST /response-snapshot` — atomically preserve both confirmed zone prefixes
- `POST /response-snapshot/restore`
- `POST /credentials/rotate`
- `POST /traffic/reopen`

## Contract and attacker moves

1. Both workspaces must exist before a stage is applied. Stages are applied in
   order. A workspace belongs to the current credential epoch.
2. Workspace creation returns `201 Created (A|B)` or the single globally permitted
   `503 Control-plane flood`. A successful create replaces that zone at prefix 0.
3. A stage request may return `204 Applied`, the single expiry-initiating
   `401 Credential compromised`, the single ambiguous `504 Edge timeout`, or
   the single `409 Capacity eviction(victim)`.
4. After `401`, all protected requests return `401` until credential rotation.
   Rotation returns `200 Rotated`, advances the shared epoch, and invalidates
   both ordinary workspaces. Every request except rotation is protected.
5. Immediately after `504`, status for that zone may report either the prior
   prefix or a prefix including the timed-out stage. That response resolves the
   hidden outcome. Other valid status requests report the current prefix.
6. Capacity eviction applies no requested stage and invalidates the attacker-
   selected victim workspace. The other zone and durable snapshot survive.
7. Snapshot returns `201 Snapshotted` iff both workspaces are valid in the
   current epoch, atomically recording both confirmed prefixes. Otherwise it
   returns `409 Invalid workspace` (or `401` while compromised). A later
   snapshot replaces the earlier one.
8. Restore returns `201 Restored` and recreates both current-epoch workspaces
   from the snapshot, or `409 No snapshot` if none exists (or `401`).
9. Reopen returns `201 Traffic reopened` iff both current-epoch workspaces have
   stages 1 and 2; otherwise `409 Unsafe to reopen` (or `401`). This is the only
   success event.
10. The `503`, `401`, `504`, and capacity eviction may each occur at most once,
    independently and in any order. For eviction, the attacker chooses A or B.
11. Exactly one listed response follows every request. Success must occur within
    **20 requests**.

## Task

Give a deterministic causal policy covering every legal response branch,
remembered state, a worst-case request-count proof, and assumptions. The tight
interaction matters: credential rotation destroys unsnapshotted progress;
restoring may discard newer progress in the unaffected zone; and an ambiguous
timeout must be observed before the controller can safely count its stage.
