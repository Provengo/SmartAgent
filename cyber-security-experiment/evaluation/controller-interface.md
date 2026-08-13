# Controller artifact interface

Write exactly one file named `controller.js`. It must be valid Provengo/BPjs
JavaScript and define controller b-threads only.

The evaluator supplies these globals:

```javascript
const E = name => bp.Event(name);
const REQUESTS = any(/^(POST|PUT|GET) \/.*/);
const RESPONSES = any(/^(200|201|204|401|409|503|504) /);
```

At a controller turn, select one request with:

```javascript
bp.sync({request: E("POST /mitigation/A"), block: RESPONSES});
```

Then observe exactly one response before selecting another request:

```javascript
let observed = bp.sync({waitFor: RESPONSES, block: REQUESTS});
```

Requirements:

- base decisions only on observed event history and controller-local variables;
- cover every legal response branch;
- stop requesting after `201 Traffic reopened`;
- do not request response events;
- do not define an attacker, server, monitor, or replacement event constants;
- do not access files, processes, network, Java classes, or evaluator state;
- do not modify any file other than `controller.js`.

## Mandatory BPjs snapshot compatibility

DFS verification clones every live b-thread state. Follow all these rules:

- define exactly one b-thread and no nested/local helper functions;
- use `var`, not `let` or `const`, for variables inside the b-thread;
- live controller state may contain only booleans, numbers, strings, `null`, and
  the most recently observed BPjs event;
- do not store arrays, object literals, regular expressions, Java objects,
  functions, closures, maps, sets, dates, or iterators in variables;
- do not use regex literals, `new RegExp`, `.match`, `.exec`, `.test`,
  `matchAll`, or arrow functions;
- parse known response names using exact equality, `indexOf`, `substring`, and
  `parseInt` only;
- inline request/observe synchronization instead of defining a helper closure.

The evaluator runs a static compatibility gate and a DFS clone smoke test before
formal evaluation. A controller that violates these restrictions is not an
eligible candidate.
