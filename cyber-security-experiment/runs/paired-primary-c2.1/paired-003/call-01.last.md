Implemented the deterministic, snapshot-compatible controller in [controller.js](C:\Users\geraw\provengo\SmartAgent\cyber-security-experiment\runs\paired-primary-c2.1\paired-003\controller.js).

It uses exactly one b-thread, primitive `var` state, inline synchronization, checkpoint/restore recovery, and explicit branches for all contract responses.