# L5 blind baseline outcome

The first trial was discarded before scoring because it correctly identified
that the original English contract specified a necessary, but not sufficient,
condition for commit success.  The contract was clarified and frozen at commit
`5104fd9` before replacement trials.

Two fresh no-tool baseline agents independently rejected the 18-request bound.
Both found that natural checkpoint policies have a 19-request adversarial case.
One initially proposed an 18-request accounting and then corrected itself after
noticing that refresh/restore also forces replay of a successful PUT.

The corrected Provengo depth-38 run subsequently confirmed their concern with
concrete bounded-reachability counterexamples.  Therefore L5 is not evidence
for the target treatment advantage; it is evidence that both arms can catch a
subtle bound error, and that verifier depth must include the first forbidden
request event.
