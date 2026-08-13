Replaced `controller.js` with a complete deterministic controller.

It now handles expiry before an initial snapshot, all recovery branches, ambiguous timeout confirmation, atomic restores, and avoids regex state that breaks Provengo b-thread serialization. Syntax check passed.