# Operating Checklist

## Standard Order
1. Confirm the runtime and target entry URL.
2. Run anti-hallucination gate selection (`L0..L5`) before testing.
3. Check UI shell, language persistence, and visible state paths before deeper backend chains.
4. Choose the smallest useful role set.
5. Set a timeout for every task before running it.
6. Run independent checks in parallel.
7. Reconcile any values that must match.
8. If code changed, rebuild/restart before retesting.
9. Log the evidence and the next step.

## Suggested Timeout Bands
- UI shell render / locale switch: 20-30 seconds
- Front-end click path: 30 seconds per step
- Normal backend write: 30 seconds per request group
- Transaction-heavy flow: 60 seconds
- Burst or stress batch: 120 seconds

## Failure Rules
- One timeout may be retried once.
- Two repeated timeouts become a stuck verdict.
- Any read/write mismatch requires reconciliation before further testing.
- Any old runtime or stale build requires recovery before more testing.

## Recovery Rules
- Stop the old process first.
- Rebuild the changed code.
- Start the new runtime.
- Re-run only the smallest verification needed to prove the fix.

## Evidence Template
- role:
- target:
- action:
- result:
- timeout:
- mismatch:
- recovery:
