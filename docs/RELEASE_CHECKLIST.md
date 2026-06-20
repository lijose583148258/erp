# Release Checklist

Before publishing a package:

1. Confirm `git status --short` is empty.
2. Run `npm ci`.
3. Run `npm --prefix backend ci`.
4. Run `npm run prisma:validate`.
5. Run `npm run typecheck`.
6. Run `npm run build:backend`.
7. Run `npm run build`.
8. Run `npm run test`.
9. Run targeted browser/API audits for touched modules.
10. Run `npm run verify:current-mainline`.
11. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-stable.ps1`.
12. Verify `AilaoDa_Stable_Package\SOURCE_MANIFEST.json` has `"sourceDirtyCount": 0`.
13. Generate and publish SHA256 with the release artifact.

Do not publish a package built from dirty source.
