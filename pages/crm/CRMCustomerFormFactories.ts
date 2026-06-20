import type { Contact, CustomerAddress } from '../../types';

export const createEmptyAddress = (type: CustomerAddress['type'] = 'legal'): CustomerAddress => ({
  type,
  label: type === 'legal' ? '法定主体' : type === 'shipping' ? '发货站点' : '附加站点',
  fullAddress: '',
  isPrimary: type === 'legal',
  countryCode: '',
});

export const createEmptyContact = (isPrimary = true): Contact => ({
  name: '',
  position: '',
  phone: '',
  email: '',
  isPrimary,
  role: '',
  department: '',
  language: 'zh',
  mobile: '',
  whatsapp: '',
  wechat: '',
  siteLabel: '',
});
