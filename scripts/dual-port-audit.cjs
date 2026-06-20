#!/usr/bin/env node

console.warn(
  '[LEGACY_SCRIPT_REDIRECT] scripts/dual-port-audit.cjs is deprecated. Running scripts/dual-port-audit-v2.cjs instead.',
);

require('./dual-port-audit-v2.cjs');
