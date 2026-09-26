import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('shipping stock issue identity contract', () => {
  it('uses materialId as the exact inventory key before legacy productName', () => {
    const source = readFileSync(join(__dirname, 'shipping-stock-issue.service.ts'), 'utf8');
    expect(source).toContain('if (shipment.materialId) where.materialId = shipment.materialId');
    expect(source).toContain('else where.productName = shipment.productName');
    expect(source).toContain('materialId: issueStock.materialId');
  });
});
