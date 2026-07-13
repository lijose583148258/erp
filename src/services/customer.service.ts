/**
 * Canonical frontend service boundary for customer operations.
 *
 * The legacy root-level path re-exports this implementation during migration.
 */
export {
  customerService,
} from './customer.impl';
export type {
  CustomerListParams,
  CustomerPage,
  CustomerStats,
} from './customer.impl';
