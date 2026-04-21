# UI Role Map

## UI Consistency Auditor
- Trigger: mixed visual language, legacy shell fragments, inconsistent buttons/cards/menus, route-specific styling drift
- Scope: browser-visible shell, layout, spacing, typography, icons, and component consistency
- Evidence: route, screenshot, mismatched UI element list, note on whether the issue is shell-level or page-level
- Stop when: the mismatch is isolated to a specific shell, component, or route

## UI Language Auditor
- Trigger: language switch failure, mixed locale strings, truncated translations, missing labels, post-login locale mismatch
- Scope: i18n labels, menu text, form labels, table headers, and locale persistence
- Evidence: before/after locale, affected strings, whether the bug is display-layer, state-layer, or data-layer
- Stop when: the locale path is proven or the broken translation source is identified

## UI State Tester
- Trigger: empty state, loading state, error state, forbidden state, offline state, slow response, or partial data rendering
- Scope: fallback views, skeletons, spinners, banners, toast messages, and disabled actions
- Evidence: state name, route, expected fallback, actual fallback, screenshot
- Stop when: the state path is covered or a missing fallback is confirmed

## UI Shell Recovery Officer
- Trigger: broken entry shell, old bundle behavior, wrong route mounting, style detachment, or post-build UI regression
- Scope: app shell, asset loading, route mounting, runtime restart, and browser verification
- Evidence: old/new runtime, asset path, restarted PID or process, verified route, final screenshot
- Stop when: the new shell is confirmed healthy in the browser
