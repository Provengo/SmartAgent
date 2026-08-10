---
theme: default
title: Verified Controller Planning with Provengo
info: |
  An evidence-backed replay of a fresh-agent controller synthesis experiment.
transition: fade-out
mdc: true
colorSchema: dark
fonts:
  sans: Inter
  mono: JetBrains Mono
---

<div class="title-kicker">FRESH-AGENT EXPERIMENT · WAREHOUSE ROBOTICS</div>

# Provengo turns controller ideas into claims we can test

<div class="title-sub">A counterexample-guided path from event stories to a bounded winning strategy</div>

<div class="title-proof">verification_mode · aec262a0 · depth 20</div>

<!--
[Sources]
- Local experiment: runs/fresh-agent-002/strategy.md
-->

---

# The controller plays against every legal response

<div class="game-contract">
  <div class="actor system"><span>SYSTEM</span><b>selects one robot event</b></div>
  <div class="turn-arrow">→</div>
  <div class="actor environment"><span>ENVIRONMENT</span><b>selects any legal response</b></div>
  <div class="turn-arrow">→</div>
  <div class="actor goal"><span>GOAL</span><b>deliver safely by event 9</b></div>
</div>

<div class="claim">A favorable simulation is insufficient. The strategy must survive the worst legal event selection.</div>

<!--
[Sources]
- Benchmark: skills/provengo-controller-planner/references/warehouse-corridor-challenge.md
-->

---

# Verification found a defect before it became evidence

<WarehouseTrace src="/traces/monitor-failure.json" accent="#ff6b6b" />

<div class="footnote">The failure was in the independent turn monitor—not in the controller. That distinction came from replaying the counterexample.</div>

<!--
[Sources]
- Local verifier report: runs/fresh-agent-002/verification-final.html
-->

---

# The counterexample led to a minimal repair

<div class="repair-flow">
  <div><span>1</span><b>Replay</b><p>Request → Grant triggered TURN_FAILURE</p></div>
  <div><span>2</span><b>Classify</b><p>Monitor synchronization error</p></div>
  <div><span>3</span><b>Repair</b><p>Use explicit system/environment waits</p></div>
  <div><span>4</span><b>Reverify</b><p>Keep the environment fully open</p></div>
</div>

<div class="integrity-callout">The repair changed the observer, not the legal game.</div>

<!--
[Sources]
- Local experiment: runs/fresh-agent-002/strategy.md
-->

---

# The repaired strategy survives the worst branch

<WarehouseTrace src="/traces/verified-success.json" accent="#37d67a" />

<div class="footnote">The environment spends its only denial immediately. The controller retries, enters as soon as access is granted, and completes in six system events.</div>

<!--
[Sources]
- Local model: runs/fresh-agent-002/warehouse-controller/spec/js/warehouse.js
-->

---

# The final claim is bounded, explicit, and reproducible

<div class="result-layout">
  <div class="result-mark">0</div>
  <div class="result-copy">
    <div class="result-label">FINAL VIOLATIONS</div>
    <pre>INFO [VERIFY] Max DFS depth: 20
INFO [VERIFY] No violations found.</pre>
  </div>
</div>

<div class="metrics-line">
  <span><b>9</b> system-event limit</span>
  <span><b>6</b> worst-case system events</span>
  <span><b>11</b> longest complete trace</span>
  <span><b>20</b> verification depth</span>
</div>

<!--
[Sources]
- Local verification log: runs/fresh-agent-002/verification-repaired.log
-->

---

# This establishes the workflow—not yet the comparative advantage

<div class="next-grid">
  <div class="done"><b>Established</b><p>A fresh agent translated stories, built a BProgram, diagnosed counterexamples, repaired the model, and reached a clean verification result.</p></div>
  <div class="next"><b>Next experiment</b><p>Give the same hidden challenges and budgets to Provengo-guided and naive agents, then compare unsafe-controller and guaranteed-delivery rates.</p></div>
</div>

<div class="closing">The report is ready to add each future strategy as one trace JSON file.</div>

<!--
[Sources]
- Experiment scope: report/README.md
-->
