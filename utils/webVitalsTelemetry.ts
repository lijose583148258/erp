type WebVitalMetricName = 'cls' | 'fcp' | 'inp_approx' | 'lcp' | 'ttfb' | 'navigation' | 'long_task';
type WebVitalRating = 'good' | 'needs_improvement' | 'poor' | 'unknown';
type RouteGroup = 'app' | 'auth' | 'orders' | 'procurement' | 'warehouse' | 'finance' | 'unknown';

type WebVitalPayload = {
  name: WebVitalMetricName;
  value: number;
  rating: WebVitalRating;
  routeGroup: RouteGroup;
  navigationType: string | undefined;
};

type LayoutShiftEntry = PerformanceEntry & {
  value?: number;
  hadRecentInput?: boolean;
};

type EventTimingEntry = PerformanceEntry & {
  duration?: number;
  interactionId?: number;
};

declare global {
  interface Window {
    __AILAODA_WEB_VITALS_STARTED__?: boolean;
  }
}

const LOCAL_BROWSER_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DEFAULT_PRODUCTION_SAMPLE_RATE = 0.1;
const MAX_SEND_BODY_BYTES = 8192;

const clampSampleRate = (value: unknown) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  return Math.min(1, Math.max(0, numberValue));
};

const resolveSampleRate = () => {
  const explicit = clampSampleRate(import.meta.env.VITE_WEB_VITALS_SAMPLE_RATE);
  if (explicit !== null) return explicit;
  return import.meta.env.PROD ? DEFAULT_PRODUCTION_SAMPLE_RATE : 1;
};

const resolveMetricsUrl = () => {
  const explicitBaseUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_ABSOLUTE_URL;
  if (explicitBaseUrl) return `${String(explicitBaseUrl).replace(/\/+$/, '')}/metrics/web-vitals`;

  const { protocol, hostname, port, origin } = window.location;
  if (port === '5001') return `${origin}/api/metrics/web-vitals`;
  if (LOCAL_BROWSER_HOSTS.has(hostname)) return `${protocol}//${hostname}:5001/api/metrics/web-vitals`;
  return `${origin}/api/metrics/web-vitals`;
};

const resolveRouteGroup = (): RouteGroup => {
  const pathname = window.location.pathname.toLowerCase();
  if (/^\/(login|auth|signin|sign-in)(\/|$)/.test(pathname)) return 'auth';
  if (/^\/(orders|sales|contracts)(\/|$)/.test(pathname)) return 'orders';
  if (/^\/(procurement|purchase|suppliers)(\/|$)/.test(pathname)) return 'procurement';
  if (/^\/(warehouse|warehouses|inventory|shipping|rma)(\/|$)/.test(pathname)) return 'warehouse';
  if (/^\/(finance|collections|collection|receivables|barter)(\/|$)/.test(pathname)) return 'finance';
  if (pathname === '/' || pathname.startsWith('/dashboard') || pathname.startsWith('/app')) return 'app';
  return 'app';
};

const rateMetric = (name: WebVitalMetricName, value: number): WebVitalRating => {
  if (!Number.isFinite(value)) return 'unknown';
  if (name === 'cls') {
    if (value <= 0.1) return 'good';
    if (value <= 0.25) return 'needs_improvement';
    return 'poor';
  }
  if (name === 'lcp') {
    if (value <= 2500) return 'good';
    if (value <= 4000) return 'needs_improvement';
    return 'poor';
  }
  if (name === 'inp_approx') {
    if (value <= 200) return 'good';
    if (value <= 500) return 'needs_improvement';
    return 'poor';
  }
  if (name === 'fcp' || name === 'ttfb') {
    if (value <= 1800) return 'good';
    if (value <= 3000) return 'needs_improvement';
    return 'poor';
  }
  if (name === 'long_task') {
    if (value <= 100) return 'good';
    if (value <= 250) return 'needs_improvement';
    return 'poor';
  }
  return 'unknown';
};

const sendMetric = (metric: WebVitalPayload) => {
  try {
    const body = JSON.stringify(metric);
    if (body.length > MAX_SEND_BODY_BYTES) return;
    const url = resolveMetricsUrl();

    if (navigator.sendBeacon) {
      try {
        const sent = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        if (sent) return;
      } catch {
        // Browser telemetry is best-effort only.
      }
    }

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {
      // Metrics failures must never interrupt ERP workflows.
    });
  } catch {
    // Telemetry stays silent if serialization or browser APIs are unavailable.
  }
};

const reportMetric = (name: WebVitalMetricName, value: number, navigationType?: string) => {
  if (!Number.isFinite(value) || value < 0) return;
  sendMetric({
    name,
    value: Number(value.toFixed(name === 'cls' ? 4 : 2)),
    rating: rateMetric(name, value),
    routeGroup: resolveRouteGroup(),
    navigationType,
  });
};

const observeEntryType = (
  type: string,
  handler: (entry: PerformanceEntry) => void,
  options: PerformanceObserverInit = { buffered: true },
) => {
  if (!('PerformanceObserver' in window)) return;
  const supported = PerformanceObserver.supportedEntryTypes || [];
  if (!supported.includes(type)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        try {
          handler(entry);
        } catch {
          // Individual observer failures must not affect page behavior.
        }
      }
    });
    observer.observe({ type, ...options });
  } catch {
    // Unsupported observer options vary by browser; telemetry stays optional.
  }
};

const reportNavigationMetrics = () => {
  try {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (!navigation) return;

    const navigationType = navigation.type || 'navigate';
    if (navigation.responseStart > 0 && navigation.startTime >= 0) {
      reportMetric('ttfb', navigation.responseStart - navigation.startTime, navigationType);
    }
    if (navigation.loadEventEnd > 0 && navigation.startTime >= 0) {
      reportMetric('navigation', navigation.loadEventEnd - navigation.startTime, navigationType);
    }
  } catch {
    // Navigation timing is optional telemetry.
  }
};

export const startWebVitalsTelemetry = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__AILAODA_WEB_VITALS_STARTED__) return;
  if (resolveSampleRate() <= 0 || Math.random() > resolveSampleRate()) return;
  window.__AILAODA_WEB_VITALS_STARTED__ = true;

  try {
    if (document.readyState === 'complete') {
      reportNavigationMetrics();
    } else {
      window.addEventListener('load', reportNavigationMetrics, { once: true });
    }

    let lastLcpValue: number | null = null;
    let maxInteractionDuration = 0;
    let clsSessionValue = 0;
    let clsSessionStartTime = 0;
    let clsSessionLastTime = 0;
    let maxClsSessionValue = 0;
    const reportedFinalMetrics = new Set<WebVitalMetricName>();

    const reportFinalMetricOnce = (name: WebVitalMetricName, value: number) => {
      if (reportedFinalMetrics.has(name)) return;
      reportedFinalMetrics.add(name);
      reportMetric(name, value);
    };

    const flushFinalMetrics = () => {
      if (lastLcpValue !== null) reportFinalMetricOnce('lcp', lastLcpValue);
      if (maxClsSessionValue > 0) reportFinalMetricOnce('cls', maxClsSessionValue);
      if (maxInteractionDuration > 0) reportFinalMetricOnce('inp_approx', maxInteractionDuration);
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushFinalMetrics();
    });

    observeEntryType('layout-shift', (entry) => {
      const layoutShift = entry as LayoutShiftEntry;
      const value = Number(layoutShift.value || 0);
      if (layoutShift.hadRecentInput || !Number.isFinite(value) || value <= 0) return;

      const startTime = layoutShift.startTime;
      const isNewSession = clsSessionValue === 0 ||
        startTime - clsSessionLastTime > 1000 ||
        startTime - clsSessionStartTime > 5000;

      if (isNewSession) {
        clsSessionValue = value;
        clsSessionStartTime = startTime;
      } else {
        clsSessionValue += value;
      }

      clsSessionLastTime = startTime;
      maxClsSessionValue = Math.max(maxClsSessionValue, clsSessionValue);
    });

    observeEntryType('paint', (entry) => {
      if (entry.name === 'first-contentful-paint') reportMetric('fcp', entry.startTime);
    });

    observeEntryType('largest-contentful-paint', (entry) => {
      lastLcpValue = entry.startTime;
    });

    observeEntryType('event', (entry) => {
      const eventTiming = entry as EventTimingEntry;
      if (!eventTiming.interactionId || !eventTiming.duration) return;
      maxInteractionDuration = Math.max(maxInteractionDuration, eventTiming.duration);
    }, { durationThreshold: 40 } as PerformanceObserverInit);

    observeEntryType('longtask', (entry) => {
      reportMetric('long_task', entry.duration);
    });
  } catch {
    // Init must fail silently because it runs from the application entrypoint.
  }
};
