# Incident controller interface

Write exactly one file named `strategy.js`. It must register one deterministic
incident controller:

```javascript
registerIncidentController(function () {
  var phase = "START";
  var observed = null;
  while (true) {
    selectRequest("POST /mitigation/A");
    observed = observeResponse();
    // update primitive state and choose the next request
  }
});
```

Available operations:

- `selectRequest(path)` selects one request from the challenge contract.
- `observeResponse()` returns the matching observed response event.
- `observed.name` is the exact response string from the contract.

Requirements:

- use only observed history and local state;
- cover every legal response branch;
- register exactly one controller and define no nested helper functions;
- use `var`, not `let` or `const`;
- persistent state may contain only strings, numbers, booleans, `null`, and the
  latest observed response;
- do not use regex, arrays, stored objects, closures, maps, sets, dates, Java
  objects, processes, files, network access, or external tools;
- parse response names using equality, `indexOf`, `substring`, and `parseInt`;
- execute `return;` immediately after observing `201 Traffic reopened`;
- modify no file other than `strategy.js`.

The runtime checks the artifact mechanically. It does not complete missing
branches or improve controller decisions.
