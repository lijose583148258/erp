import { z } from 'zod';

const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
const customerSegmentSchema = z.enum(['direct', 'channel', 'mixed']);
const poolStateSchema = z.enum(['public', 'internal', 'private']);

const contactSchema = z.object({
  name: z.string().trim().max(80).optional(),
  position: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(160).or(z.literal('')).optional(),
  isPrimary: z.boolean().optional(),
  role: z.string().trim().max(80).optional(),
  department: z.string().trim().max(80).optional(),
  language: z.enum(['zh', 'en', 'vi']).optional(),
  mobile: z.string().trim().max(40).optional(),
  whatsapp: z.string().trim().max(80).optional(),
  wechat: z.string().trim().max(80).optional(),
  addressId: z.string().trim().optional(),
  siteLabel: z.string().trim().max(60).optional(),
}).passthrough();

const addressSchema = z.object({
  id: z.string().trim().optional(),
  type: z.enum(['legal', 'shipping', 'office', 'billing', 'other']).optional(),
  label: z.string().trim().max(60).optional(),
  fullAddress: z.string().trim().min(1).max(500),
  isPrimary: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
  registeredName: z.string().trim().max(160).optional(),
  registrationNo: z.string().trim().max(80).optional(),
  taxNo: z.string().trim().max(80).optional(),
  countryCode: z.string().trim().min(2).max(3).optional(),
  city: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(20).optional(),
}).passthrough();

const customerBaseSchema = z.object({
  name: z.string().trim().max(160).optional(),
  nameZh: z.string().trim().max(160).optional(),
  nameEn: z.string().trim().max(160).optional(),
  nameVi: z.string().trim().max(160).optional(),
  nameAliases: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  licenseNumber: z.string().trim().max(80).optional(),
  creditLimit: z.coerce.number().nonnegative().optional(),
  riskLevel: riskLevelSchema.optional(),
  segment: customerSegmentSchema.optional(),
  poolState: poolStateSchema.optional(),
  salespersonId: z.coerce.number().int().positive().nullable().optional(),
  assignedSalespersonId: z.coerce.number().int().positive().nullable().optional(),
  contactName: z.string().trim().max(80).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  contactEmail: z.string().trim().email().max(160).or(z.literal('')).optional(),
  address: z.string().trim().max(500).optional(),
  addresses: z.array(addressSchema).optional(),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  termsDays: z.coerce.number().int().min(1).max(365).optional(),
  isPublicPool: z.coerce.boolean().optional(),
  poolReason: z.string().trim().optional(),
  poolUpdatedAt: z.string().trim().optional(),
  licenseUrl: z.string().trim().optional(),
  licenseStatus: z.enum(['pending', 'verified', 'expired']).optional(),
  hazardousLicenseExpiry: z.string().trim().optional(),
  contacts: z.array(contactSchema).optional(),
}).passthrough();

export const createCustomerSchema = customerBaseSchema.superRefine((value, ctx) => {
  if (!value.name && !value.nameZh && !value.nameEn && !value.nameVi) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['name'],
      message: 'At least one company name is required.',
    });
  }
});

export const updateCustomerSchema = customerBaseSchema.partial().refine(
  value => Object.keys(value).length > 0,
  { message: '至少提供一个可更新字段' }
);

export const updateCustomerPoolSchema = z.object({
  poolState: poolStateSchema,
  salespersonId: z.coerce.number().int().positive().nullable().optional(),
  reason: z.string().trim().optional(),
}).passthrough();

export const customerContactSchema = contactSchema;
