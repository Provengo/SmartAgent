Replaced `controller.js` with a complete causal controller.

It now normalizes BPjs event names before comparisons, resolves every timeout via status, checkpoints safely before stages, handles rotation/eviction/restore branches, and stops after reopen. The documented worst-case bound is 19 requests. `node --check controller.js` passes.