# Guided L4 strategy

Upload chunks in order and checkpoint after chunk 2 while authentication expiry remains possible. After `504`, query status and either accept the reported stored chunk or retry it. After `401`, refresh. If a checkpoint exists, restore it; otherwise create a new session. Since the one expiry has then been spent, omit further checkpoints and finish the upload.

The worst combined branch uses the one `503`, resolves an unstored timeout with `GET` plus retry, and later receives a late `401`. It completes within 14 requests (28 selected request/response events).

```text
INFO [VERIFY] Max DFS depth: 28
INFO [VERIFY] No violations found.
```
