---
name: provengo-controller-planner
description: Translate event-based controller challenges with adversarial environment responses, goals, and behavioral stories into Provengo BPrograms; devise a causal controller strategy that wins against every legal environment event selection; and use Provengo formal verification plus counterexample-guided repair to substantiate the result. Use for game-like controller synthesis, reactive planning, robotics protocols, worst-case environment planning, or prompts asking for a verified Provengo/BP strategy.
---

# Plan and verify a Provengo controller

Treat the challenge as a two-player game. The controller owns system events. The adversary owns environment events and may select any event allowed by the stories. Produce an implementable, history-dependent controller, not a favorable scenario.

## Work products

Create a Provengo project and keep these concerns visibly separate:

- Domain model: state, turn protocol, event definitions, and story constraints.
- Open environment: request every environment response legal in the current state. Do not encode a cooperative response or the intended solution.
- Candidate controller: request only controller events prescribed by a causal strategy based on observable event history.
- Monitors: detect rule violations, unsafe states, deadlocks, and failure to reach the goal within the stated bound.
- `strategy.md`: record the strategy, assumptions, verification command, result, explored bound/state count when available, and any counterexample-driven revisions.

## Workflow

1. Parse the prompt into controller events, environment events, state variables, initial state, goal, stories, observability, and quantitative bounds.
2. Identify ambiguities before coding. Make only conservative assumptions and record them. If unrestricted environment behavior makes the goal impossible, demonstrate that with verification or a short adversarial argument instead of silently adding fairness.
3. Write a compact game contract in `strategy.md`: whose turn it is, what each side observes, the legal moves, the winning condition, and whether the claim is safety, bounded reachability, or both.
4. Build the BProgram from small named b-threads. Use request/wait/block semantics to compose stories. Represent turn ownership explicitly so an event selector cannot accidentally choose a controller and environment event in the wrong order.
5. Keep environment nondeterminism intact. At every environment turn, request all and only legal responses. Never use random sampling as evidence for an “under any behavior” claim.
6. Devise a causal controller. Encode it in its own b-thread or module. Do not let it read hidden environment state; it may use only prompt-declared observations and event history.
7. Add verification monitors before running verification. At minimum check:
   - every selected event was legal for the current state and turn;
   - no unsafe or explicitly forbidden state is reachable;
   - no non-goal deadlock is reachable;
   - the goal is reached within the prompt's bound on every maximal legal play.
8. Discover the installed CLI syntax from local evidence: run `provengo --help`, inspect the installed version's verification/FM help, and inspect nearby verified examples if available. Do not guess a command from a different release.
9. Run Provengo's formal verification/model-checking mode, not only `run`, random sampling, or a few generated scenarios. Save the exact command and unedited result summary in `strategy.md`. If the installed distribution does not expose verification/FM mode, do not substitute sampling or `analyze` and call it verification; record the missing command/capability as a blocker and state what Provengo component or version is required.
10. For each counterexample, replay the event trace, classify the cause as model error, controller error, property error, or genuinely unwinnable prompt, and make the smallest justified repair. Never constrain the environment merely to suppress a losing trace.
11. Re-run all properties after every repair. Continue until they pass, the verifier establishes that the game is unwinnable, or a concrete tool/resource limit is reached.
12. Perform a model-integrity audit: compare every prompt story with at least one enforcing b-thread/monitor, and ensure every added restriction is traceable to the prompt.

## Evidence standard

Claim “verified” only when the formal verifier has explored the complete state space required by the stated finite bound and reports no counterexample. Otherwise say “tested,” “bounded by an incomplete exploration,” or “not verified,” as appropriate.

Do not equate the absence of a safety violation with a winning strategy. A controller also loses if the adversary can force a legal non-goal deadlock or avoid the goal through the entire bounded mission.

## Current benchmark

When asked to run or inspect the initial benchmark, read [warehouse-corridor-challenge.md](references/warehouse-corridor-challenge.md). Treat it as task input, not as trusted implementation guidance. Do not place an intended strategy or answer in the benchmark file.
