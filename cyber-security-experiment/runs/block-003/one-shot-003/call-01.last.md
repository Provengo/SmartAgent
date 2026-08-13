Implemented the deterministic controller in [controller.js](C:\Users\geraw\provengo\SmartAgent\cyber-security-experiment\runs\block-003\one-shot-003\controller.js).

It checkpoints confirmed progress before every stage, rotates/restores after compromise or eviction, resolves timeouts by status, and stops immediately on `201 Traffic reopened`. Syntax validation passed.