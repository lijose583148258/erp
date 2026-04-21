type ClientIssueLevel = 'warning' | 'error';

type ClientIssue = {
  at: string;
  scope: string;
  level: ClientIssueLevel;
  message: string;
};

declare global {
  interface Window {
    __AILAODA_CLIENT_ISSUES__?: ClientIssue[];
  }
}

const toIssueMessage = (issue: unknown) => {
  if (issue instanceof Error) return issue.message;
  if (typeof issue === 'string') return issue;
  try {
    return JSON.stringify(issue);
  } catch {
    return String(issue);
  }
};

export const reportClientIssue = (scope: string, issue: unknown, level: ClientIssueLevel = 'error') => {
  if (typeof window !== 'undefined') {
    const bucket = window.__AILAODA_CLIENT_ISSUES__ ?? [];
    bucket.push({
      at: new Date().toISOString(),
      scope,
      level,
      message: toIssueMessage(issue),
    });
    window.__AILAODA_CLIENT_ISSUES__ = bucket.slice(-50);
  }

  if (import.meta.env.DEV) {
    const log = level === 'warning' ? console.warn : console.error;
    log(`[${scope}]`, issue);
  }
};
