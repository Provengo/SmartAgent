# First blind response

The no-skill agent found the intended history-dependent policy on its first answer:

- Retry the single possible `503`.
- Upload chunks 1 and 2, then checkpoint their prefix.
- If `401` occurs on chunks 1–2, refresh, discard the old session, create a new one, and upload all chunks. Since expiry was spent, omit checkpoint.
- If `401` occurs on chunks 3–4, refresh, restore the `{1,2}` checkpoint, and replay chunks 3–4.
- Commit only after all chunks are present.

It calculated the request counts correctly:

| First expiry | Worst-case requests including `503` |
|---|---:|
| None | 8 |
| Chunk 1 | 10 |
| Chunk 2 | 11 |
| Chunk 3 | 11 |
| Chunk 4 | 12 |

The exact worst case is `503, create, PUT1, PUT2, checkpoint, PUT3, PUT4→401, refresh, restore, PUT3, PUT4, commit`.
