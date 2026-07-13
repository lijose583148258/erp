import { z } from 'zod';

const visibleCountsSchema = z.record(z.string().min(1).max(64), z.number().int().min(0).max(1_000_000));

export const aiAssistSchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
  language: z.enum(['zh-CN', 'en-US', 'vi-VN']).optional(),
  currentPage: z.string().trim().max(120).optional(),
  visibleCounts: visibleCountsSchema.optional(),
}).strict();

export type AIAssistInput = z.infer<typeof aiAssistSchema>;
