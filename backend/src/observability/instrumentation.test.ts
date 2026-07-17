describe('OpenTelemetry bootstrap', () => {
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const originalTracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;

  afterEach(() => {
    jest.resetModules();
    if (originalEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    if (originalTracesEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = originalTracesEndpoint;
  });

  it('stays disabled when no OTLP endpoint is configured', async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    const telemetry = await import('./instrumentation');

    expect(telemetry.getTelemetryStatus()).toMatchObject({
      configured: false,
      enabled: false,
      exporter: 'disabled',
    });
  });

  it('uses the non-blocking OTLP HTTP batch boundary instead of NodeSDK', () => {
    const source = require('fs').readFileSync(__filename.replace(/instrumentation\.test\.ts$/, 'instrumentation.ts'), 'utf8');
    expect(source).toContain("exporter: endpoint ? 'otlp-http-json' : 'disabled'");
    expect(source).toContain('OTEL_BATCH_MAX_QUEUE_SIZE');
    expect(source).not.toContain('NodeSDK');
  });
});
