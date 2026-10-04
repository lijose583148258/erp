import { can } from '../../app/permissions';
import type { CurrentUser } from '../../types';

// Skip unauthorized catalogs without hiding real failures of authorized requests.
export function loadBarterReferenceData<C, S, O>(user: CurrentUser, loaders: {
  customers: () => Promise<C[]>;
  suppliers: () => Promise<S[]>;
  orders: () => Promise<O[]>;
}) {
  return Promise.all([
    can(user, 'customers.read') ? loaders.customers() : Promise.resolve([] as C[]),
    can(user, 'procurement.suppliers.read') ? loaders.suppliers() : Promise.resolve([] as S[]),
    can(user, 'orders.read') ? loaders.orders() : Promise.resolve([] as O[]),
  ]);
}
