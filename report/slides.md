---
theme: default
title: Provengo-verified REST Recovery
transition: fade-out
mdc: true
colorSchema: dark
fonts:
  sans: Inter
  mono: JetBrains Mono
---

<div class="title-kicker">ADVERSARIAL REST ORCHESTRATION</div>

# A retry that looks reasonable can still lose

<div class="title-sub">Provengo turns HTTP status choices into a finite game, finds the failure, and verifies the repaired recovery policy.</div>

<div class="title-proof">verification_mode · REST contract · depth 24</div>

---

# The API contract is the behavioral model

<div class="game-contract">
  <div class="actor system"><span>CONTROLLER</span><b>sends one HTTP request</b></div>
  <div class="turn-arrow">→</div>
  <div class="actor environment"><span>SERVER</span><b>selects any legal status</b></div>
  <div class="turn-arrow">→</div>
  <div class="actor goal"><span>GOAL</span><b>commit within 9 requests</b></div>
</div>

<div class="claim">The server may choose one 503 and one 401. Refreshing authentication invalidates every older backup session.</div>

---

# The naive recovery reuses invalid state

<RestTrace src="/traces/naive-failure.json" accent="#ff6b6b" />

<div class="footnote">Counterexample selected by Provengo: return 401 only after chunk 1 is safely stored, then reject commit with 409.</div>

---

# The fix changes the strategy—not the server

<div class="repair-flow">
  <div><span>1</span><b>Replay</b><p>Late 401 forces token refresh</p></div>
  <div><span>2</span><b>Infer</b><p>Refresh invalidates session S1</p></div>
  <div><span>3</span><b>Repair</b><p>Create S2 and restart chunk 1</p></div>
  <div><span>4</span><b>Reverify</b><p>Preserve all legal status choices</p></div>
</div>

<div class="integrity-callout">No server response was removed. Only the controller's recovery branch changed.</div>

---

# The repaired policy survives the worst legal branch

<RestTrace src="/traces/verified-success.json" accent="#37d67a" />

<div class="footnote">The server spends both disruptions at maximum cost: 503 before creation and 401 after chunk 1.</div>

---

# The comparison is measurable

<div class="comparison-grid">
  <div class="loser"><small>NAIVE RETRY</small><b>4</b><span>counterexamples</span><p>Ends in 409 after a legal authentication failure.</p></div>
  <div class="winner"><small>VERIFIED RESTART</small><b>0</b><span>violations</span><p>Commits under every response sequence in the contract.</p></div>
</div>

<div class="metrics-line"><span><b>9</b> worst-case requests</span><span><b>18</b> longest complete trace</span><span><b>24</b> DFS depth</span></div>

---

# What Provengo contributed

<div class="next-grid">
  <div class="done"><b>Counterexample</b><p>It chose the precise response timing that defeats local retry logic.</p></div>
  <div class="done"><b>Guarantee</b><p>It checked the repaired causal policy against every legal server selection.</p></div>
</div>

<div class="closing">The difference is strategic: retry one request, or restart invalid transactional state.</div>
