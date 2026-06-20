import type { Customer } from '../types';

type CustomerPoolSource = Pick<Customer, 'poolState' | 'isPublicPool'>;

export const getCustomerPoolState = (customer: CustomerPoolSource): 'public' | 'internal' | 'private' => {
  if (customer.poolState === 'public' || customer.poolState === 'internal' || customer.poolState === 'private') {
    return customer.poolState;
  }

  return customer.isPublicPool ? 'public' : 'private';
};

export const isCustomerInPublicPool = (customer: CustomerPoolSource) => getCustomerPoolState(customer) === 'public';
