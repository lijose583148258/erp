import request from 'supertest';
import app from '../server';

describe('CSP headers', () => {
  it('isolates React style attributes without allowing inline scripts or style elements', async () => {
    const response = await request(app).get('/api/openapi.json').expect(200);
    const csp = String(response.headers['content-security-policy'] || '');
    const directives = Object.fromEntries(csp.split(';').map((entry) => {
      const [name, ...values] = entry.trim().split(/\s+/);
      return [name, values];
    }));

    expect(directives['script-src']).toEqual(["'self'"]);
    expect(directives['style-src']).toEqual(["'self'"]);
    expect(directives['style-src-elem']).toEqual(["'self'"]);
    expect(directives['style-src-attr']).toEqual(["'unsafe-inline'"]);
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
