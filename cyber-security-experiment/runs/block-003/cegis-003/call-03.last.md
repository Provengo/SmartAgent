Replaced [controller.js](C:\Users\geraw\provengo\SmartAgent\cyber-security-experiment\runs\block-003\cegis-003\controller.js).

The policy error was missing durable state at `A=2, B=0`: eviction later forced a full A rebuild, exceeding 20 requests when combined with flood, credential expiry, and timeout. The repair adds one snapshot at that boundary and restores it after eviction or rotation.

`node --check controller.js` passes.