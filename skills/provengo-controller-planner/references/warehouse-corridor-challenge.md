# Warehouse corridor controller challenge

Design a controller for an autonomous delivery robot in a warehouse. The robot starts at `STAGING`, must traverse either corridor `NORTH` or corridor `SOUTH`, and must trigger `Deliver` at `GOAL`. A forklift dispatcher controls access to both corridors.

The mission is a finite adversarial game. The event trace starts with a system turn and alternates strictly between a system event and an environment event. The controller selects system events; the environment may select any legal environment response. The controller observes the complete selected-event history but no hidden state.

## System events

- `Request(NORTH)` or `Request(SOUTH)`: request exclusive use of a corridor.
- `Wait`: remain at the current location for this system turn.
- `Enter(c)`: move from `STAGING` into the entrance of corridor `c`.
- `Advance(c)`: move from the entrance to the far end of corridor `c`.
- `Exit(c)`: move from the far end of corridor `c` to `GOAL`.
- `Cancel(c)`: relinquish a granted permit before entering its corridor.
- `Deliver`: complete the mission while at `GOAL`.

## Environment events

- `Grant(c)`: grant the immediately preceding `Request(c)`.
- `Deny(c)`: deny the immediately preceding `Request(c)`.
- `Recall(c)`: revoke an active permit for `c` while the robot is still at `STAGING`.
- `NoChange`: leave permits and corridor occupancy unchanged.
- `ForkliftEnter(c)`: place the forklift in an unreserved corridor `c`.
- `ForkliftLeave(c)`: remove the forklift from corridor `c`.

## Stories and rules

1. Turns alternate. Exactly one legal system event is followed by exactly one legal environment event.
2. `Request(c)` is legal only at `STAGING` when the robot has no active permit. Its immediately following environment event must be exactly one of `Grant(c)` or `Deny(c)`.
3. The dispatcher may select `Deny` at most once during the mission.
4. `Grant(c)` is legal only when corridor `c` has no forklift. It creates one active permit for `c`.
5. While the robot remains at `STAGING` with an active permit, the environment response may be `Recall(c)`, `NoChange`, or a legal forklift event concerning the other corridor.
6. The dispatcher may select `Recall` at most once during the mission. A recalled permit becomes inactive immediately.
7. `Enter(c)` is legal only at `STAGING` with an active permit for `c` and no forklift in `c`.
8. Once `Enter(c)` occurs, the permit for `c` cannot be recalled and the forklift cannot enter `c` until after `Exit(c)`.
9. Inside a corridor, movement is one-way: `Enter(c)` must eventually be followed by `Advance(c)` and then `Exit(c)`. The robot cannot wait, cancel, change corridors, or move backward inside it.
10. `Cancel(c)` is legal only at `STAGING` with an active permit for `c`; it removes that permit.
11. `ForkliftEnter(c)` is legal only if `c` has no forklift, has no active robot permit, and does not contain the robot. At most one corridor contains the forklift at a time.
12. `ForkliftLeave(c)` is legal only when the forklift is currently in `c`.
13. After a system event not covered by the mandatory request response in rule 2, the environment must have at least one legal response; `NoChange` is legal unless another rule explicitly requires the matching `Grant`/`Deny` response.
14. `Deliver` is legal only at `GOAL`, and selecting it ends the mission successfully.
15. A collision—robot and forklift occupying the same corridor—is forbidden.
16. The controller may select at most 9 system events, including `Deliver`. If delivery has not occurred after the ninth system event, the mission is lost.

## Goal

Create a causal system strategy that guarantees legal, collision-free delivery within 9 system events for every legal sequence of environment selections. Translate the complete challenge into a Provengo BProgram, encode the strategy separately from the open environment, and use Provengo's formal verification mode to check the guarantee. If verification finds a counterexample, repair the model or strategy as justified and verify again.

## Required report

Provide:

- the Provengo project;
- a concise strategy description;
- the exact verification command and result;
- any counterexample traces and the resulting repairs;
- a story-to-b-thread/monitor traceability table;
- a clear statement of the verified bound and assumptions.
