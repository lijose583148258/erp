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
    expect(directives['style-src']?.[0]).toBe("'self'");
    expect(directives['style-src-elem']?.[0]).toBe("'self'");
    expect(directives['style-src']?.[1]).toMatch(/^'nonce-[A-Za-z0-9+/=]+'$/);
    expect(directives['style-src-elem']?.[1]).toBe(directives['style-src']?.[1]);
    expect(directives['style-src-attr']).toEqual(["'unsafe-inline'"]);
    expect(directives['style-src']).not.toContain("'unsafe-inline'");
    expect(directives['style-src-elem']).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
