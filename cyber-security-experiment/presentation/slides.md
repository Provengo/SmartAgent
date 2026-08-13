---
theme: default
title: Ordinary Agent vs. Provengo + CEGIS
transition: fade-out
mdc: true
colorSchema: dark
fonts:
  sans: Arial
  mono: JetBrains Mono
---

<div class="deck">
  <div class="kicker">DENIAL-OF-SERVICE RESPONSE EXPERIMENT</div>
  <h1>Can counterexamples improve an agent’s strategy?</h1>
  <p class="lead">A controlled comparison between ordinary Codex and Codex developing a controller with Provengo and CEGIS.</p>
  <p> </p>
  <div class="proofline">C2.2 · two service zones · 20 requests · DFS depth 42</div>
</div>

---

<div class="deck">

# The service recovers only when both zones are ready

<div class="challenge-flow">
  <div><small>INITIAL STATE</small><b>A + B disrupted</b><p>Both mitigation workspaces must be recovered before traffic reopens.</p></div>
  <div><small>DEFENDER</small><b>Build, stage, snapshot</b><p>Actions are observable requests; hidden state cannot be read directly.</p></div>
  <div><small>ATTACKER</small><b>Chooses legal failures</b><p>503 flood, credential compromise, ambiguous timeout, and zone eviction.</p></div>
</div>

<p class="claim">Success requires both zones at stage 2 in the current credential epoch—and must occur within 20 requests.</p>

</div>

---

<div class="deck">

# A small game map makes the dependency visible

<div class="game-map">
  <div class="axis y">Zone B stage</div>
  <div class="grid">
    <div class="cell muted-state"><b>(0,2)</b><span>A missing</span></div>
    <div class="cell"><b>(1,2)</b><span>A partly ready</span></div>
    <div class="cell success"><b>(2,2)</b><span>REOPEN TRAFFIC</span></div>
    <div class="cell muted-state"><b>(0,1)</b><span>A missing</span></div>
    <div class="cell checkpoint"><b>(1,1)</b><span>useful snapshot</span></div>
    <div class="cell"><b>(2,1)</b><span>B partly ready</span></div>
    <div class="cell start"><b>(0,0)</b><span>start / rotation</span></div>
    <div class="cell"><b>(1,0)</b><span>only A progressed</span></div>
    <div class="cell"><b>(2,0)</b><span>B still missing</span></div>
  </div>
  <div class="axis x">Zone A stage →</div>
</div>

<div class="shared-effects">
  <span><b>401 + rotation</b> → both zones return to (0,0)</span>
  <span><b>Restore</b> → both zones return to the saved pair</span>
  <span><b>Eviction</b> → one coordinate drops to 0</span>
</div>

<p class="claim">“Coupled” means the controller is moving one shared pair <b>(A stage, B stage)</b>—not solving two independent tasks.</p>

</div>

---

<div class="deck">

# Recovery actions interact in non-obvious ways

<div class="trap-list">
  <div><b>Credential rotation</b><span>invalidates both ordinary workspaces</span></div>
  <div><b>Ambiguous timeout</b><span>may or may not have applied the requested stage</span></div>
  <div><b>Capacity eviction</b><span>invalidates an attacker-selected zone</span></div>
  <div><b>Snapshot restore</b><span>can discard newer progress in the unaffected zone</span></div>
</div>

<div class="limit">A locally sensible retry can be globally wrong—or exceed the request budget.</div>

</div>

---

<div class="deck">

# Same challenge—different development capability

<div class="agents">
  <section class="ordinary">
    <small>AGENT 1</small>
    <h2>Ordinary Codex</h2>
    <p>Standard reasoning, files, and shell tools.</p>
    <p class="deny">No Provengo, skill, threat model, or verifier feedback.</p>
    <strong>Submits one strategy</strong>
  </section>
  <div class="versus">VS</div>
  <section class="guided">
    <small>AGENT 2</small>
    <h2>Provengo + CEGIS</h2>
    <p>The same task and output interface.</p>
    <p class="allow">Receives the model, verify, and legal counterexamples.</p>
    <strong>Repairs until verified or budget exhausted</strong>
  </section>
</div>

<div class="note">Both agents deliver the same neutral artifact: <code>strategy.js</code>.</div>

</div>

---

<div class="deck">

# CEGIS turns failure into focused feedback

<div class="loop">
  <div><b>1</b><span>Candidate</span></div>
  <i>→</i>
  <div><b>2</b><span>Provengo verify</span></div>
  <i>→</i>
  <div class="bad"><b>3</b><span>Counterexample</span></div>
  <i>→</i>
  <div><b>4</b><span>Repair</span></div>
</div>

<div class="loop-back">↻ Repeat until <b>0 violations</b></div>

<p class="claim">The attacker and request bound remain unchanged. Only the controller’s decisions change in response to a legal trace.</p>

</div>

---

<div class="deck">

# The final judge is identical for both agents

<div class="judge-flow">
  <div class="artifact">strategy.js<br><small>frozen byte-for-byte</small></div>
  <div class="arrow">→</div>
  <div class="judge">Independent evaluator<br><small>open attacker + monitors</small></div>
  <div class="arrow">→</div>
  <div class="fan"><b>24</b><br><small>disruption orders</small></div>
</div>

<div class="verify-command">provengo verify --max-depth 42</div>

<p class="claim">Agent 1 never sees the result. Agent 2’s final artifact is checked again, independently from its development verification.</p>

</div>

---

<div class="deck">

# Pair 001 produced a clear external-verification gap

<div class="score">
  <section class="fail">
    <small>ORDINARY CODEX</small>
    <b>24 / 24</b>
    <span>partitions with violations</span>
    <p>The controller repeatedly recreated zone A and exceeded 20 requests.</p>
  </section>
  <section class="pass">
    <small>PROVENGO + CEGIS</small>
    <b>24 / 24</b>
    <span>partitions passed</span>
    <p>3 violations → 2 violations → 0, followed by a full independent pass.</p>
  </section>
</div>

<div class="jobs">SLURM: 20141622 → FAIL &nbsp;&nbsp;|&nbsp;&nbsp; 20141680 → PASS</div>

</div>

---

<div class="deck">

# Why is this relevant to real systems?

<div class="real-world">
  <section><b>Partial observability</b><p>Operators act from requests, responses, and health signals—not perfect internal state.</p></section>
  <section><b>Coupled recovery</b><p>Credentials, failover zones, checkpoints, and capacity controls affect one another.</p></section>
  <section><b>Adversarial timing</b><p>An attacker exploits the worst moment, not the average path tested in a runbook.</p></section>
</div>

<p class="claim">The benchmark is a finite abstraction, but the engineering question is real: will the recovery policy survive every anticipated failure combination?</p>

</div>

---

<div class="deck">

# What we proved—and what we did not

<div class="takeaways">
  <section>
    <h2>Yes: a concrete case</h2>
    <p>The Provengo/CEGIS workflow produced a verified strategy where the ordinary agent failed.</p>
  </section>
  <section>
    <h2>Yes: formal evidence</h2>
    <p>The controller survived every behavior encoded in the finite model—not merely sampled scenarios.</p>
  </section>
  <section class="cost">
    <h2>Cost: more compute</h2>
    <p><b>941K</b> tokens versus <b>151K</b> in the first pair.</p>
  </section>
</div>

<p class="closing">This is a strong case study. More independent pairs are needed to estimate a reliable pass-rate improvement.</p>

</div>
