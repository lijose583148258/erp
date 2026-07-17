import { recordCacheMetric, recordRumVital, renderPrometheusMetrics } from './metricsMiddleware';

describe('RUM Web Vitals metrics', () => {
  it('aggregates browser vitals with bounded and normalized labels', () => {
    expect(recordRumVital({
      name: 'LCP',
      value: 1234.567,
      rating: 'good',
      path: '/customers/123?tab=orders#section',
    })).toBe(true);

    const metrics = renderPrometheusMetrics();

    expect(metrics).toContain('ailaoda_browser_web_vitals_total{metric="LCP",rating="good",path="/customers/:id"}');
    expect(metrics).toContain('ailaoda_browser_web_vitals_value_sum{metric="LCP",rating="good",path="/customers/:id"} 1234.567');
  });

  it('rejects unknown metrics and unsafe values', () => {
    expect(recordRumVital({ name: 'URL', value: 1, rating: 'good', path: '/orders' })).toBe(false);
    expect(recordRumVital({ name: 'LCP', value: Number.POSITIVE_INFINITY, rating: 'good', path: '/orders' })).toBe(false);
    expect(recordRumVital({ name: 'LCP', value: 1, rating: 'unexpected', path: '/orders' })).toBe(false);
  });

  it('aggregates cache metrics by bounded namespace labels', () => {
    recordCacheMetric('hit', 'currency:rate-snapshot');
    recordCacheMetric('miss', 'unit.with unsafe chars:key');

    const metrics = renderPrometheusMetrics();

    expect(metrics).toContain('ailaoda_cache_operations_total{action="hit",namespace="currency"}');
    expect(metrics).toContain('ailaoda_cache_operations_total{action="miss",namespace="unit.with_unsafe_chars"}');
  });
});
