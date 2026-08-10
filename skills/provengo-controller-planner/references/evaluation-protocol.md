# Fair comparative evaluation

When comparing a Provengo-guided agent with a no-tool baseline:

1. Freeze and commit the contract and bound before baseline execution.
2. Give both conditions identical task information, model family, reasoning effort, and output requirements.
3. Isolate fresh agents from repository files, prior answers, counterexamples, and conversation history.
4. Preserve the baseline's first answer and encode it without repairing or completing its policy.
5. Evaluate both policies against the same open-environment BProgram and monitors.
6. Use multiple independent trials per level; report every trial and every previously attempted level.
7. Define a complexity threshold by pass-rate separation, not by selecting one favorable failure.
8. Distinguish planning success from evidence: an unverified but correct policy and a verifier-passing policy are different experimental outcomes.

Do not weaken the baseline, tune a frozen task after seeing its answer, or claim that Provengo is the only possible source of assurance.
