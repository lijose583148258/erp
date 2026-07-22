import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import Skeleton, { TableSkeleton } from '../components/Skeleton';
import { RootErrorFallback } from '../components/ErrorBoundary';
import { PageErrorFallback } from '../components/PageErrorBoundary';
import {
  getBadgeText,
  getStatusBorderBadgeClassName,
  getStatusLabel,
  getStatusTone,
  isHighRiskStatus,
  normalizeStatus,
} from '../components/ui/statusBadgeLogic';
import {
  formatDate,
  getCollectionCustomerLabel,
  getElapsedDays,
  getHoldStrategy,
  paymentBadge,
  riskBadge,
  riskRank,
  statusBadge,
} from '../pages/collections/collectionCenter.helpers';
import { serializeServerStateKey, serverStateClient } from '../app/serverState';
import {
  getEffectiveBomQuantityPerUnit,
  isEffectiveBomItemDraft,
  normalizeDosageValue,
  normalizeRoleValue,
  parseBomPasteText,
} from '../pages/production/productionBomLineModel';
import {
  validateAdjustmentForm,
  validateBomForm,
  validateQualityForm,
  validateWorkOrderForm,
} from '../pages/production/productionWorkspaceSave';
import { createInitialWorkOrderSteps } from '../pages/production/productionWorkspaceConfig';
import { buildSalesOrderUpdatePayload, mapSalesOrderItem } from '../src/services/order.mapping';

type FrontendUnitTest = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: FrontendUnitTest[] = [
  {
    name: 'sales order update payload maps payment terms to the backend contract',
    run: () => {
      const payload = buildSalesOrderUpdatePayload({
        id: '42',
        customerId: '7',
        paymentTermsDays: 45,
        contractId: '',
        items: [],
      } as any);
      assert.equal(payload.customerId, 7);
      assert.equal(payload.paymentTerms, 45);
      assert.equal(payload.contractId, null);
    },
  },
  {
    name: 'sales order mapping restores packaging from the canonical specification field',
    run: () => {
      const item = mapSalesOrderItem({
        id: 1,
        productName: 'Resin A',
        specification: '25kg/drum',
        quantity: 5,
        unit: 'kg',
        unitPrice: 99,
        totalPrice: 495,
        notes: null,
      });
      assert.equal(item.packagingSpec, '25kg/drum');
      assert.equal(item.amount, 495);
      assert.equal(item.notes, undefined);
    },
  },
  {
    name: 'production workspace validators preserve save boundaries',
    run: () => {
      const bom = validateBomForm({
        productName: '',
        outputUnit: '',
        formulationMode: 'percentage',
        standardBatchSizeInput: '0',
        percentageSummary: 99,
        effectiveItemCount: 2,
        bomType: 'chemical_formula',
      });
      assert.equal(bom.standardBatchSize, 0);
      assert.equal(bom.errors.productName, '请填写产品名称');
      assert.equal(bom.errors.outputUnit, '请填写输出单位');
      assert.ok(bom.errors.standardBatchSize);
      assert.ok(bom.errors.percentage);
      assert.ok(bom.errors.items);

      const workOrder = validateWorkOrderForm({ productName: '树脂', targetQuantityInput: '0' });
      assert.equal(workOrder.targetQuantity, 0);
      assert.ok(workOrder.errors.targetQuantity);

      const quality = validateQualityForm({ result: 'fail', defectRateInput: '101', checkedBy: '' });
      assert.equal(quality.defectRateValue, 101);
      assert.ok(quality.errors.defectRate);
      assert.ok(quality.errors.checkedBy);

      const adjustment = validateAdjustmentForm({ hasBatch: false, quantityInput: '-1', reason: '' });
      assert.equal(adjustment.quantity, -1);
      assert.ok(adjustment.errors.batch);
      assert.ok(adjustment.errors.quantity);
      assert.ok(adjustment.errors.reason);
      assert.deepEqual(createInitialWorkOrderSteps().map((step) => step.title), ['备料', '生产', '质检']);
    },
  },
  {
    name: 'production BOM model normalizes rows and parses batch paste quantities',
    run: () => {
      assert.equal(normalizeRoleValue('主树脂'), 'main_resin');
      assert.equal(normalizeDosageValue('按百分比'), 'percentage');

      const parsed = parseBomPasteText(
        '树脂\tR-1\t主树脂\t按百分比\t20\t200\tkg\n助剂\tA-1\t助剂\t固定单耗\t\t3.5\tkg',
        1000,
      );
      assert.equal(parsed.importedItems.length, 2);
      assert.equal(parsed.importedItems[0]?.quantityPerUnit, '0.2');
      assert.equal(parsed.importedItems[1]?.quantityPerUnit, '3.5');
      assert.equal(parsed.conversionNotices.length, 1);
      assert.equal(getEffectiveBomQuantityPerUnit(parsed.importedItems[0]!), 0.2);
      assert.equal(isEffectiveBomItemDraft(parsed.importedItems[0]!), true);
      assert.equal(isEffectiveBomItemDraft({ ...parsed.importedItems[0]!, materialName: '', materialCode: '' }), false);
    },
  },
  {
    name: 'status badge logic normalizes status and maps risk tones',
    run: () => {
      assert.equal(normalizeStatus('In Review'), 'in_review');
      assert.equal(getStatusTone('paid'), 'emerald');
      assert.equal(getStatusTone('critical'), 'rose');
      assert.equal(getStatusTone('not-a-known-status'), 'neutral');
      assert.equal(isHighRiskStatus('overdue'), true);
      assert.equal(isHighRiskStatus('paid'), false);
      assert.match(getStatusBorderBadgeClassName('verified'), /emerald/);
      assert.equal(getStatusLabel('custom-status'), 'custom-status');
      assert.equal(getBadgeText(['A', 2, null], 'fallback'), 'A 2');
      assert.equal(getBadgeText([null], 'fallback'), 'fallback');
    },
  },
  {
    name: 'collection center helpers preserve business display fallbacks',
    run: () => {
      assert.equal(formatDate('2026-07-08T10:20:30.000Z'), '2026-07-08');
      assert.equal(formatDate('not-a-date'), 'not-a-date');
      assert.equal(getCollectionCustomerLabel({ customerNameEn: 'Acme Trading' }), 'Acme Trading');
      assert.equal(getCollectionCustomerLabel({}), '-');
      assert.equal(getHoldStrategy('customer-credit'), '暂停授信，复核回款计划');
      assert.equal(getHoldStrategy('order-shipment'), '订单冻结，经理复核后释放');
      assert.equal(riskRank('critical'), 4);
      assert.equal(riskRank('unknown'), 1);
      assert.match(paymentBadge('paid'), /emerald/);
      assert.match(paymentBadge('partial'), /amber/);
      assert.match(riskBadge('high'), /rose/);
      assert.match(statusBadge('open'), /rose/);
    },
  },
  {
    name: 'elapsed day helper handles invalid and historical dates',
    run: () => {
      const now = Date.now;
      Date.now = () => new Date('2026-07-08T00:00:00.000Z').getTime();
      try {
        assert.equal(getElapsedDays(null), '-');
        assert.equal(getElapsedDays('not-a-date'), '-');
        assert.equal(getElapsedDays('2026-07-06T00:00:00.000Z'), '2 天');
      } finally {
        Date.now = now;
      }
    },
  },
  {
    name: 'Skeleton renders stable loading markup without browser APIs',
    run: () => {
      const markup = renderToStaticMarkup(
        <Skeleton variant="rounded" width={120} height={24} animation="none" className="unit-test-skeleton" />,
      );

      assert.match(markup, /unit-test-skeleton/);
      assert.match(markup, /rounded-2xl/);
      assert.match(markup, /width:120px/);
      assert.match(markup, /height:24px/);
    },
  },
  {
    name: 'TableSkeleton renders the expected row and column placeholders',
    run: () => {
      const markup = renderToStaticMarkup(<TableSkeleton rows={2} columns={3} />);
      const columnWidthMatches = markup.match(/width:33\.333333333333336%/g) || [];

      assert.ok(markup.includes('bg-white'));
      assert.equal(columnWidthMatches.length, 9);
    },
  },
  {
    name: 'error boundaries render actionable fallback UI',
    run: () => {
      const rootMarkup = renderToStaticMarkup(
        <RootErrorFallback error={new Error('root failure')} componentStack="Root > App" copied={false} />,
      );
      assert.match(rootMarkup, /role="alert"/);
      assert.match(rootMarkup, /系统遇到错误/);
      assert.match(rootMarkup, /重新加载/);
      assert.match(rootMarkup, /复制错误/);
      assert.match(rootMarkup, /root failure/);

      const pageMarkup = renderToStaticMarkup(
        <PageErrorFallback pageId="orders" error={new Error('page failure')} showDetail />,
      );
      assert.match(pageMarkup, /当前页面加载失败/);
      assert.match(pageMarkup, /orders/);
      assert.match(pageMarkup, /收起错误详情/);
      assert.match(pageMarkup, /page failure/);
    },
  },
  {
    name: 'server state client dedupes fresh queries and invalidates by prefix',
    run: () => {
      serverStateClient.clear();
      assert.equal(serializeServerStateKey(['orders', { pageSize: 30, page: 1 }]), serializeServerStateKey(['orders', { page: 1, pageSize: 30 }]));

      let calls = 0;
      const key = ['unit', 'server-state', Date.now()];
      const first = serverStateClient.fetchQuery({
        key,
        queryFn: async () => {
          calls += 1;
          return { value: calls };
        },
      });
      const second = serverStateClient.fetchQuery({
        key,
        queryFn: async () => {
          calls += 1;
          return { value: calls };
        },
      });

      return Promise.all([first, second]).then(async ([firstResult, secondResult]) => {
          assert.equal(firstResult.value, 1);
          assert.equal(secondResult.value, 1);
          assert.equal(calls, 1);

          const cached = await serverStateClient.fetchQuery({
            key,
            queryFn: async () => {
              calls += 1;
              return { value: calls };
            },
          });
          assert.equal(cached.value, 1);
          assert.equal(calls, 1);

          serverStateClient.invalidateQueries(['unit']);
          const refreshed = await serverStateClient.fetchQuery({
            key,
            queryFn: async () => {
              calls += 1;
              return { value: calls };
            },
          });
          assert.equal(refreshed.value, 2);
          assert.equal(calls, 2);
      });
    },
  },
  {
    name: 'enterprise grid mounts only the TanStack virtual row window',
    run: async () => {
      const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
      const window = dom.window;

      Object.defineProperties(globalThis, {
        window: { configurable: true, value: window },
        document: { configurable: true, value: window.document },
        navigator: { configurable: true, value: window.navigator },
        HTMLElement: { configurable: true, value: window.HTMLElement },
        Element: { configurable: true, value: window.Element },
        Node: { configurable: true, value: window.Node },
        getComputedStyle: { configurable: true, value: window.getComputedStyle.bind(window) },
      });

      class TestResizeObserver implements ResizeObserver {
        constructor(private readonly callback: ResizeObserverCallback) {}

        observe(target: Element) {
          const height = target.tagName === 'TR' ? 48 : 560;
          const rect = window.DOMRect.fromRect({ width: 980, height });
          queueMicrotask(() => {
            this.callback([{
              target,
              contentRect: rect,
              borderBoxSize: [{ inlineSize: 980, blockSize: height }],
              contentBoxSize: [{ inlineSize: 980, blockSize: height }],
              devicePixelContentBoxSize: [{ inlineSize: 980, blockSize: height }],
            } as ResizeObserverEntry], this);
          });
        }

        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
      }

      Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: TestResizeObserver });
      Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver });
      Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value() {
          const height = this.tagName === 'TR' ? 48 : 560;
          return window.DOMRect.fromRect({ width: 980, height });
        },
      });

      const { cleanup, render, waitFor } = await import('@testing-library/react');
      const { EnterpriseDataGrid } = await import('../components/ui/EnterpriseDataGrid');
      const rows = Array.from({ length: 200 }, (_, index) => ({ id: `row-${index}`, name: `Customer ${index}` }));
      const result = render(
        <EnterpriseDataGrid
          data={rows}
          columns={[{ key: 'name', header: 'Customer', accessor: 'name' }]}
          rowKey="id"
          searchable={false}
          defaultPageSize={200}
          pageSizeOptions={[200]}
          virtualizeThreshold={20}
          virtualViewportHeight={560}
          virtualRowHeight={48}
        />,
      );

      await waitFor(() => {
        const viewport = result.container.querySelector('[data-virtualizer="tanstack"]');
        assert.ok(viewport);
        assert.equal(viewport.getAttribute('data-virtual-row-count'), '200');
        const mountedRows = result.container.querySelectorAll('tbody tr[data-index]').length;
        assert.ok(mountedRows > 0, 'the virtualizer should mount a visible row window');
        assert.ok(mountedRows < rows.length, 'the virtualizer should not mount every loaded row');
      });

      cleanup();
      dom.window.close();
    },
  },
];

let failed = 0;

(async () => {
  for (const test of tests) {
    try {
      await test.run();
      console.log(`PASS ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${test.name}`);
      console.error(error);
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
})();
