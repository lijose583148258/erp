import {
  applyBusinessFilters,
  createEmptyBusinessFilterState,
  hasActiveBusinessFilters,
  matchesBusinessFilter,
  type BusinessFilterDefinition,
  type BusinessFilterState,
} from '../components/ui/businessFilters.ts';

type Row = {
  id: string;
  createdAt: string;
  amount: string | number;
  status: string;
  risky: boolean;
  customerName: string;
};

const rows: Row[] = [
  { id: 'A', createdAt: '2026-07-01', amount: '1,200.50', status: 'approved', risky: false, customerName: 'Alpha Chemical' },
  { id: 'B', createdAt: '2026-07-05', amount: '2 500', status: 'pending', risky: true, customerName: 'Beta Lab' },
  { id: 'C', createdAt: '2026-08-01', amount: 900, status: 'rejected', risky: true, customerName: 'Gamma Trade' },
];

const definitions: BusinessFilterDefinition<Row>[] = [
  { key: 'createdAt', label: 'Created', kind: 'dateRange', field: 'createdAt' },
  { key: 'amount', label: 'Amount', kind: 'amountRange', field: 'amount' },
  { key: 'status', label: 'Status', kind: 'multiSelect', field: 'status' },
  { key: 'risky', label: 'Risky', kind: 'boolean', field: 'risky' },
  { key: 'customerName', label: 'Customer', kind: 'text', field: 'customerName' },
];

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const ids = (items: Row[]) => items.map((item) => item.id).join(',');

const getRow = (id: string): Row => {
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error(`Expected test row ${id} to exist`);
  return row;
};

const run = () => {
  const empty = createEmptyBusinessFilterState();
  assert(!hasActiveBusinessFilters(empty), 'empty filter state should not be active');
  assert(ids(applyBusinessFilters(rows, definitions, empty)) === 'A,B,C', 'empty filter state should preserve all rows');

  const state: BusinessFilterState = {
    keyword: '',
    updatedAt: '2026-07-07T00:00:00.000Z',
    values: {
      createdAt: { from: '2026-07-01', to: '2026-07-31' },
      amount: { min: '1,000', max: '2 500' },
      status: ['approved', 'pending'],
    },
  };
  assert(hasActiveBusinessFilters(state), 'non-empty filter state should be active');
  assert(ids(applyBusinessFilters(rows, definitions, state)) === 'A,B', 'range and multi-select filters should match July approved/pending rows');

  const booleanDefinition = definitions.find((item) => item.key === 'risky');
  assert(booleanDefinition, 'boolean definition should exist');
  assert(matchesBusinessFilter(getRow('B'), booleanDefinition!, true), 'boolean true should match true row values');
  assert(!matchesBusinessFilter(getRow('A'), booleanDefinition!, true), 'boolean true should reject false row values');

  const textDefinition = definitions.find((item) => item.key === 'customerName');
  assert(textDefinition, 'text definition should exist');
  assert(matchesBusinessFilter(getRow('A'), textDefinition!, 'alpha'), 'text filter should be case-insensitive');
  assert(!matchesBusinessFilter(getRow('B'), textDefinition!, 'alpha'), 'text filter should reject non-matching rows');

  const manualSafe = applyBusinessFilters(rows, [], state);
  assert(manualSafe === rows, 'missing filter definitions should return the original row array');
};

run();
console.log('Business filter contract audit passed');
