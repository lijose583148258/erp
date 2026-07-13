import { createTraceContext, parseTraceparent } from './traceContext';

describe('trace context middleware helpers', () => {
  it('accepts valid W3C traceparent and creates a child span', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const parentSpanId = '00f067aa0ba902b7';
    const context = parseTraceparent(`00-${traceId}-${parentSpanId}-01`);

    expect(context).toMatchObject({
      traceId,
      requestId: traceId,
      sampled: true,
      source: 'incoming',
    });
    expect(context?.spanId).not.toBe(parentSpanId);
    expect(context?.traceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
  });

  it('rejects invalid or all-zero traceparent values', () => {
    expect(parseTraceparent('bad')).toBeNull();
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01')).toBeNull();
  });

  it('generates a sampled request trace when none is provided', () => {
    const context = createTraceContext();

    expect(context.source).toBe('generated');
    expect(context.sampled).toBe(true);
    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(context.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

});
