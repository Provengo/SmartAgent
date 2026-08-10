# Provengo-guided controller planning: verification report

This report documents a fresh-agent experiment in which an agent used the repository-local `provengo-controller-planner` skill to translate a warehouse robotics challenge into a BProgram, devise a controller, run Provengo verification, repair counterexamples, and verify again.

## Result

The repaired controller passed bounded formal verification:

```text
INFO [VERIFY] Max DFS depth: 20
INFO [VERIFY] No violations found.
```

The longest complete play contains 11 selected events, so the depth-20 search covers the complete finite game encoded by this benchmark.

| Measure | Result |
|---|---:|
| Controller system-event bound | 9 |
| Worst-case strategy length | 6 system events |
| Longest complete play | 11 total events |
| Verification depth | 20 |
| Final violations | 0 |

## Interactive presentation

The Slidev presentation replays the counterexample and successful strategy as controllable animations:

```powershell
cd report
npm install
npm run dev
```

Use the on-screen controls to play, pause, step, restart, or change playback speed. Build a static GitHub Pages-compatible site with `npm run build`.

## What failed first

The first executable model produced two real verifier counterexamples:

```text
Request(NORTH), Grant(NORTH) -> TURN_FAILURE
Request(NORTH), Deny(NORTH)  -> TURN_FAILURE
```

These were not controller losses. They exposed a synchronization error in the independent turn monitor. The agent classified the defect correctly, replaced the monitor with explicit alternating waits, preserved every legal environment response, and verified again.

## Verified strategy

1. Request `NORTH`.
2. If the request is denied, request `NORTH` again.
3. After a grant, enter immediately.
4. Advance, exit, and deliver.

Only one denial is legal. A mandatory request response prevents a forklift event between a request and its grant or denial. Immediate entry prevents permit recall. The worst-case trace is:

```text
Request(NORTH) -> Deny(NORTH) -> Request(NORTH) -> Grant(NORTH)
-> Enter(NORTH) -> NoChange -> Advance(NORTH) -> NoChange
-> Exit(NORTH) -> NoChange -> Deliver
```

## Reproducibility

Provengo source:

- Repository: `C:\Users\geraw\provengo\SeleniumBasedTests`
- Branch: `verification_mode`
- Commit: `aec262a0`

Exact verification command:

```powershell
java -jar "C:\Users\geraw\provengo\SeleniumBasedTests\target\testory-c1-0.7.5-SNAPSHOT.uber.jar" `
  --batch-mode --no-color verify --max-depth 20 `
  -o "verification-repaired.html" `
  "C:\Users\geraw\provengo\SmartAgent\runs\fresh-agent-002\warehouse-controller"
```

Evidence and source artifacts:

- [`strategy.md`](../runs/fresh-agent-002/strategy.md)
- [`warehouse.js`](../runs/fresh-agent-002/warehouse-controller/spec/js/warehouse.js)
- [`verification-repaired.log`](../runs/fresh-agent-002/verification-repaired.log)
- [`verification-final.html`](../runs/fresh-agent-002/verification-final.html)

## Scope of the claim

The result verifies the encoded controller against every environment choice represented by this finite BProgram. It does not establish correctness for a physical warehouse outside the model. This run also does not yet compare against a separately generated naive controller; the trace-player format is ready to accept that experiment as another JSON trace.
