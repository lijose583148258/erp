# ADR 0028: CSP React Style Attribute Boundary

## Status

Accepted

## Context

The application keeps scripts and stylesheets on the same origin, but React components use dynamic style attributes for measured virtual rows, table column widths, progress indicators, and loading placeholders. A default `style-src 'self'` policy blocks those runtime attributes even though static header audits pass, leaving layout and virtualization partially disabled in production browsers.

Adding `unsafe-inline` to the broad `style-src` directive would also permit inline `<style>` elements. Nonces do not solve arbitrary React style attributes, and enumerating hashes is not viable for measured values.

## Decision

Use CSP3 directive separation:

- `script-src 'self'` remains strict and does not allow inline scripts.
- `style-src 'self'` and `style-src-elem 'self'` allow only same-origin stylesheets and reject inline `<style>` blocks.
- `style-src-attr 'unsafe-inline'` is the explicit compatibility boundary for React dynamic style attributes.
- `AILAODA_ALLOW_UNSAFE_INLINE_CSP` remains an emergency escape hatch for the broader script/style policy and is disabled by default.
- Header tests assert each directive independently, while browser audits treat CSP console violations as release failures.

## Consequences

Virtual row spacing, dynamic column widths, and progress indicators work under the production CSP without weakening script execution or inline style-element controls. Style attributes remain a narrower accepted risk and must never carry untrusted CSS text; components should continue deriving values from typed numeric or allow-listed inputs.
