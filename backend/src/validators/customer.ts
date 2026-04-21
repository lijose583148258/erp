import { z } from 'zod';

const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
const customerSegmentSchema = z.enum(['direct', 'channel', 'mixed']);
const poolStateSchema = z.enum(['public', 'internal', 'private']);

const contactSchema = z.object({
  name: z.string().trim().optional(),
  position: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  isPrimary: z.boolean().optional(),
  role: z.string().trim().optional(),
  department: z.string().trim().optional(),
  language: z.enum(['zh', 'en', 'vi']).optional(),
  mobile: z.string().trim().optional(),
  whatsapp: z.string().trim().optional(),
  wechat: z.string().trim().optional(),
  addressId: z.string().trim().optional(),
  siteLabel: z.string().trim().optional(),
}).passthrough();

const addressSchema = z.object({
  id: z.string().trim().optional(),
  type: z.enum(['legal', 'shipping', 'office', 'billing', 'other']).optional(),
  label: z.string().trim().optional(),
  fullAddress: z.string().trim().min(1),
  isPrimary: z.boolean().optional(),
  note: z.string().trim().optional(),
  registeredName: z.string().trim().optional(),
  registrationNo: z.string().trim().optional(),
  taxNo: z.string().trim().optional(),
  countryCode: z.string().trim().min(2).max(3).optional(),
  city: z.string().trim().optional(),
  region: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
}).passthrough();

const customerBaseSchema = z.object({
  name: z.string().trim().optional(),
  nameZh: z.string().trim().optional(),
  nameEn: z.string().trim().optional(),
  nameVi: z.string().trim().optional(),
  licenseNumber: z.string().trim().optional(),
  creditLimit: z.coerce.number().nonnegative().optional(),
  riskLevel: riskLevelSchema.optional(),
  segment: customerSegmentSchema.optional(),
  poolState: poolStateSchema.optional(),
  salespersonId: z.coerce.number().int().positive().nullable().optional(),
  assignedSalespersonId: z.coerce.number().int().positive().nullable().optional(),
  contactName: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  contactEmail: z.string().trim().optional(),
  address: z.string().trim().optional(),
  addresses: z.array(addressSchema).optional(),
  notes: z.string().trim().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  termsDays: z.coerce.number().int().positive().optional(),
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
