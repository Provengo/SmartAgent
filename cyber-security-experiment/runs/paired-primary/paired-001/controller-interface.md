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

