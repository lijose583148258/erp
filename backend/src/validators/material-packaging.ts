import { z } from 'zod';
import { packagingUnits } from '../domain/production-packaging-basis';

export const createPackagingRevisionSchema = z.object({
  specCode: z.string().trim().min(1).max(48).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/),
  version: z.string().trim().min(1).max(32),
  packageUnit: z.enum(packagingUnits),
  netMass: z.string().trim().max(24).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/).refine(v => Number(v) > 0),
  massUnit: z.enum(['mg', 'g', 'kg', 't']),
  sourceReference: z.string().trim().min(1).max(240),
}).strict();
export const reviewPackagingRevisionSchema = z.object({
  expectedUpdatedAt: z.iso.datetime(),
  reason: z.string().trim().min(1).max(240),
}).strict();
