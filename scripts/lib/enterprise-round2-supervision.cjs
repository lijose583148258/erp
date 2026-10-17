// Narrow process supervision for the serial fixed37 audit, not a job platform.
// Per-check deadlines still belong to createRound2Runner. The parent watches
// actual case transitions, not log size or arbitrary heartbeat writes.
const ROUND2_MAX_RUNTIME_MS = 15 * 60_000;
const ROUND2_PARENT_RUNTIME_MS = ROUND2_MAX_RUNTIME_MS + 30_000;
function createRound2Supervisor(start, { hardLimitMs = ROUND2_MAX_RUNTIME_MS, idleLimitMs = 90_000, checkGraceMs = 15_000, exitGraceMs = 10_000 } = {}) {
  let signature, lastProgress = start, activeId, activeSince = start, activeBudget = 180_000, finishedSince;
  return function inspect(report, now) {
    if (now - start >= hardLimitMs) return 'round2-overall-deadline';
    if (report && Array.isArray(report.checks) && report.checks.length === 37
      && new Set(report.checks.map(c => c.id)).size === 37) {
      const current = report.checks.filter(c => c.status === 'running');
      if (current.length > 1) return 'round2-multiple-active-checks';
      const next = JSON.stringify(report.checks.map(c => [c.id, c.status, c.startedAt || null, c.finishedAt || null]));
      if (next !== signature) { signature = next; lastProgress = now; }
      if (report.finishedAt) {
        finishedSince ??= now;
        if (now - finishedSince >= exitGraceMs) return 'round2-process-did-not-exit';
        return null;
      }
      if (current.length) {
        const check = current[0];
        if (check.id !== activeId) { activeId = check.id; activeSince = now;
          // The existing payment-reversal browser chain already owns 240s.
          // Supervision must not shorten that runner deadline to the usual 180s.
          // The owned PG crash case reserves independent restoration time;
          // every other case retains the reviewed 240s maximum.
          const maximum = check.id === 'database-restart-ambiguous-commit' ? 300_000 : 240_000;
          activeBudget = Number.isSafeInteger(check.timeoutMs) && check.timeoutMs > 0 ? Math.min(check.timeoutMs, maximum) : 180_000; }
        if (now - activeSince >= activeBudget + checkGraceMs) return `round2-check-deadline:${activeId}`;
        return null;
      }
      activeId = undefined;
    }
    if (now - lastProgress >= idleLimitMs) return 'round2-no-case-progress';
    return null;
  };
}
module.exports = { ROUND2_MAX_RUNTIME_MS, ROUND2_PARENT_RUNTIME_MS, createRound2Supervisor };
