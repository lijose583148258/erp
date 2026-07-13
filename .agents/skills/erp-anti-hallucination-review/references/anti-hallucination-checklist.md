# Anti-Hallucination Checklist

## Gate L0
- problem layer identified
- active route/runtime confirmed

## Gate L1
- `tsc --noEmit`
- `npm run build`
- `npm run build:backend`

## Gate L2
- route opens correctly
- shell and key labels render correctly
- no stale-entry drift

## Gate L3
- create -> save -> refresh -> read-back
- API read-back matches browser read-back
- key IDs captured

## Gate L4
- backup succeeds
- restore succeeds
- login and key read-back after restore succeeds

## Gate L5
- single runtime chain
- single health-check contract
- old entry points cannot hijack release path

## Report Hygiene
- no field-name collisions in audit report
- pass/fail meaning is explicit and stable

## Encoding Hygiene
- triage first, fix second
- mojibake gate enforced after fix
