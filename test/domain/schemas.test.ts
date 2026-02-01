import { describe, it, expect } from 'vitest';
import { processContractInput, reviewActionInput, workflowStateSchema } from '../../src/domain/schemas.js';

describe('processContractInput', () => {
  it('accepts valid input', () => {
    const result = processContractInput.safeParse({
      pdfBase64: 'dGVzdA==',
      verticalSlug: 'energy',
      filename: 'contract.pdf',
    });
    expect(result.success).toBe(true);
  });

  it('accepts without optional filename', () => {
    const result = processContractInput.safeParse({
      pdfBase64: 'dGVzdA==',
      verticalSlug: 'energy',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty pdfBase64', () => {
    const result = processContractInput.safeParse({
      pdfBase64: '',
      verticalSlug: 'energy',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing verticalSlug', () => {
    const result = processContractInput.safeParse({
      pdfBase64: 'dGVzdA==',
    });
    expect(result.success).toBe(false);
  });
});

describe('reviewActionInput', () => {
  it('accepts approve action', () => {
    const result = reviewActionInput.safeParse({ action: 'approve' });
    expect(result.success).toBe(true);
  });

  it('accepts correct with correctedData', () => {
    const result = reviewActionInput.safeParse({
      action: 'correct',
      correctedData: { monthly_rate: 29.99 },
      notes: 'Fixed rate',
    });
    expect(result.success).toBe(true);
  });

  it('rejects correct without correctedData', () => {
    const result = reviewActionInput.safeParse({ action: 'correct' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid action', () => {
    const result = reviewActionInput.safeParse({ action: 'cancel' });
    expect(result.success).toBe(false);
  });
});

describe('workflowStateSchema', () => {
  it('accepts valid states', () => {
    expect(workflowStateSchema.safeParse('pending').success).toBe(true);
    expect(workflowStateSchema.safeParse('extracting').success).toBe(true);
    expect(workflowStateSchema.safeParse('completed').success).toBe(true);
  });

  it('rejects invalid state', () => {
    expect(workflowStateSchema.safeParse('invalid').success).toBe(false);
  });
});
