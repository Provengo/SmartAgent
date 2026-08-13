# Guided recovery strategy

## Game contract

The controller chooses one defensive action, then the open environment chooses
one legal result. The controller observes event history only. The claim is both
safety (no false declaration of recovery) and bounded reachability (two genuine,
authenticated healthy checks within eight actions).

## Policy

1. Rotate the leaked origin credential.
2. Provision green while it is hidden.
3. Harden green before exposure.
4. Enable authenticated health probes.
5. Switch traffic to green.
6. Restart the process on the protected green path.
7. Obtain two consecutive genuine healthy checks.

All outcomes along this policy are forced by the contract; attacker choices
remain open for any policy that filters blue, exposes an unhardened standby,
keeps the leaked credential, or trusts unauthenticated health.

Worst case equals the sole guided trace and uses exactly eight actions. The
policy assumes only the finite contract in `benchmark/challenge.md`.

## Verification evidence

Command:

```powershell
java -jar 'C:\Users\geraw\provengo\SeleniumBasedTests\target\testory-c1-0.7.5-SNAPSHOT.uber.jar' --batch-mode --no-color verify --max-depth 20 -o '..\verification.html' 'cyber-security-experiment\conditions\guided\incident-controller'
```

Status (C0 calibration only): `No violations found.` at DFS depth 20 on
2026-08-13. The unedited output is in `verification.log` and the HTML report is
in `verification.html`. This establishes toolchain/model integrity for C0; it is
explicitly excluded from evidence that model guidance improves planning.
