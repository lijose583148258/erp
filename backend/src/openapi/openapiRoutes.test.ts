import request from 'supertest';
import app from '../server';

describe('OpenAPI HTTP routes', () => {
  it('serves the contract from the compatibility and v1 namespaces', async () => {
    const compatibilityResponse = await request(app).get('/api/openapi.json').expect(200);
    const v1Response = await request(app).get('/api/v1/openapi.json').expect(200);

    expect(compatibilityResponse.body.openapi).toBe('3.0.3');
    expect(v1Response.body.openapi).toBe('3.0.3');
    expect(v1Response.body.paths['/api/v1/auth']).toBeDefined();
  });

  it('serves a browser-readable docs landing page', async () => {
    const response = await request(app).get('/api/v1/docs').expect(200);

    expect(response.text).toContain('/api/v1/openapi.json');
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('does not expose metrics or upload files anonymously', async () => {
    await request(app).get('/metrics').expect(401);
    await request(app).get('/uploads/contracts/example.pdf').expect(401);
    await request(app).get('/uploads/pod/example.pdf').expect(401);
  });

  it('accepts privacy-safe browser Web Vitals samples', async () => {
    const response = await request(app)
      .post('/api/rum/vitals')
      .send({
        vitals: [
          { name: 'LCP', value: 1800, rating: 'good', path: '/orders/123?debug=true#top' },
        ],
      })
      .expect(202);

    expect(response.body).toEqual({ success: true, accepted: 1 });
  });

  it('rejects invalid browser Web Vitals payloads', async () => {
    await request(app)
      .post('/api/v1/rum/vitals')
      .send({ vitals: [{ name: 'FULL_URL', value: 1, rating: 'good', path: 'https://example.test/orders' }] })
      .expect(400);
  });
});
