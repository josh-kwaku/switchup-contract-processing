import { z } from 'zod';
import { REVIEW_STATUSES, WORKFLOW_STATES } from './types.js';

export const workflowStateSchema = z.enum(WORKFLOW_STATES);

export const reviewStatusSchema = z.enum(REVIEW_STATUSES);

export const processContractInput = z.object({
  pdfBase64: z.string().min(1, 'PDF data is required'),
  verticalSlug: z.string().min(1, 'Vertical slug is required'),
  filename: z.string().optional(),
});

export const reviewActionInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), notes: z.string().optional() }),
  z.object({ action: z.literal('reject'), notes: z.string().optional() }),
  z.object({
    action: z.literal('correct'),
    correctedData: z.record(z.string(), z.unknown()),
    notes: z.string().optional(),
  }),
]);

export const extractRequestInput = z.object({
  pdfText: z.string().min(1, 'PDF text is required'),
  verticalSlug: z.string().min(1, 'Vertical slug is required'),
});

export type ProcessContractInput = z.infer<typeof processContractInput>;
export type ReviewActionInput = z.infer<typeof reviewActionInput>;
export type ExtractRequestInput = z.infer<typeof extractRequestInput>;
