---
name: erp-ai-feature-governance
description: Governed AI feature skill for AilaoDa ERP/CRM. Use when planning, auditing, or implementing internal AI assistant, OCR, Smart Form Fill, import parsing, command bar, AI analytics, model settings, privacy gates, role isolation, external model calls, red-team tests, and AI evidence reporting.
---

# ERP AI Feature Governance

## Mission

Enhance internal AI features without weakening ERP trust. AI must help operators work faster while preserving permission boundaries, privacy, auditability, and human confirmation for business writes.

## Current Project Anchors

Use these repo surfaces as first evidence:

- `components/AIAssistant.tsx`
- `components/AISettings.tsx`
- `components/SmartFormFill.tsx`
- `components/TableImport.tsx`
- `services/aiSecurity.ts`
- `services/aiConfig.ts`
- `services/geminiService.ts`
- `services/freeAIService.ts`
- `services/smartFormService.ts`
- `scripts/ai-security-regression.ts`
- `scripts/ai-isolation-redteam-regression.ts`
- `scripts/crm-ai-assistant-browser-audit-v1.cjs`
- `scripts/crm-permission-ai-audit-v1.cjs`

## AI Runtime Rules

1. Prefer local or rule-based mode by default.
2. External AI must be opt-in, privacy-gated, and blocked for sensitive business prompts.
3. Never send raw customer, supplier, order, finance, formula, contact, bank, address, or audit data to external models.
4. Build safe context from counts, route, role, language, and allowed summaries only.
5. AI suggestions that create, update, import, approve, or delete business records require preview and human confirmation.
6. Every high-risk AI refusal, import, or write suggestion needs audit evidence or a reproducible test.

## Enhancement Roadmap

Use this order for future implementation PRs:

1. AI governance audit:
   - inventory entry points, model settings, privacy gates, scripts, screenshots, and stale/mojibake text
   - verify role isolation in API, UI, and browser assistant views

2. Assistant UX hardening:
   - role-aware prompt suggestions
   - clear data boundary copy
   - mobile-safe drawer, keyboard/focus, language readability
   - visible refusal and fallback states

3. Smart import/OCR safety:
   - template, preview, duplicate policy, failed-row export
   - no direct commit without review
   - row-level validation and read-back evidence

4. AI command bar:
   - navigation and read-only query intent first
   - no hidden writes or permission bypass
   - tool contracts with allowed modules and output schemas

5. AI analytics:
   - canonical metrics and source links
   - explanation with confidence and unavailable markers
   - no fabricated KPI details

6. Agent runtime:
   - planner, executor, verifier separation
   - typed tool registry
   - trace logs, eval cases, recovery, and cost/latency guardrails

## Evaluation Gates

- `npm run audit:ai:isolation`
- `tsx scripts/ai-security-regression.ts`
- `node scripts/crm-ai-assistant-browser-audit-v1.cjs`
- `node scripts/crm-permission-ai-audit-v1.cjs`
- targeted browser screenshots for sales, finance, admin, and restricted roles

## Output Shape

```text
ai surface:
allowed data:
blocked data:
human confirmation:
audit evidence:
eval/red-team case:
future PR:
```
