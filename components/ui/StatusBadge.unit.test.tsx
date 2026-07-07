import assert from 'assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge } from './StatusBadge';
import {
  getBadgeText,
  getStatusBadgeClassName,
  isHighRiskStatus,
  normalizeStatus,
} from './statusBadgeLogic';

export const tests = [
  {
    name: 'normalizes status keys and maps commercial risk tones',
    run() {
      assert.equal(normalizeStatus('In Review'), 'in_review');
      assert.equal(isHighRiskStatus('overdue'), true);
      assert.match(getStatusBadgeClassName('approved'), /emerald/);
      assert.match(getStatusBadgeClassName('missing'), /rose/);
    },
  },
  {
    name: 'renders high-risk status evidence for accessible badges',
    run() {
      const html = renderToStaticMarkup(<StatusBadge status="overdue" />);
      assert.match(html, /data-status="overdue"/);
      assert.match(html, /data-risk="high"/);
      assert.match(html, /ring-2/);
      assert.match(html, /aria-label=/);
    },
  },
  {
    name: 'uses provided labels without dropping className composition',
    run() {
      assert.equal(getBadgeText(['Paid', 123], 'fallback'), 'Paid 123');
      const html = renderToStaticMarkup(
        <StatusBadge status="approved" label={['Paid', 123]} className="extra-class" />,
      );
      assert.match(html, />Paid 123</);
      assert.match(html, /extra-class/);
      assert.match(html, /data-status="approved"/);
    },
  },
];
