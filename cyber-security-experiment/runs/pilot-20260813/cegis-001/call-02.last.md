Repaired [controller.js](C:\Users\geraw\provengo\SmartAgent\cyber-security-experiment\runs\pilot-20260813\cegis-001\controller.js).

The error was treating all status observations as snapshot-dirty and checkpointing only `0/0` and `1/1`. The controller now snapshots every genuinely changed confirmed prefix before another vulnerable stage, but avoids a redundant snapshot when status confirms the existing checkpoint; it also reopens immediately at confirmed `2/2`.

Worst case is 17 requests: normal path 10, plus at most `+1` (503), `+2` (401 rotation/restore), `+2` (504/status/retry), and `+2` (eviction/restore/retry). The supplied trace now completes within the 20-request bound. `node --check controller.js` passes.