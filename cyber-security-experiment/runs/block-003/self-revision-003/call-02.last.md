Replaced [controller.js](C:\Users\geraw\provengo\SmartAgent\cyber-security-experiment\runs\block-003\self-revision-003\controller.js) with a snapshot-based bounded recovery controller.

Worst-case request count is 19: 12 baseline plus 503 (1), 504/status (1), eviction/retry/restore (2), and compromise/rotate/restore/retry (3).