import { describe, it, expect } from 'vitest';
import { validateAndScore } from '../../src/services/validation/index.js';
import { validateExtractedData } from '../../src/services/validation/schema-validator.js';

const requiredFields = ['provider', 'monthly_rate', 'contract_start'];

describe('validateExtractedData', () => {
  it('returns no errors when all required fields are present and valid', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 50, contract_start: '2026-01-01' };
    const errors = validateExtractedData(data, requiredFields);
    expect(errors).toHaveLength(0);
  });

  it('returns missing_field error for absent fields', () => {
    const data = { provider: 'Vattenfall' };
    const errors = validateExtractedData(data, requiredFields);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({ field: 'monthly_rate', code: 'missing_field', message: "Required field 'monthly_rate' is missing" });
  });

  it('returns empty_field error for null/empty values', () => {
    const data = { provider: '', monthly_rate: 50, contract_start: '2026-01-01' };
    const errors = validateExtractedData(data, requiredFields);
    expect(errors).toEqual([{ field: 'provider', code: 'empty_field', message: "Required field 'provider' is empty" }]);
  });

  it('returns vertical_mismatch error', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 50, contract_start: '2026-01-01', vertical_match: false };
    const errors = validateExtractedData(data, requiredFields);
    expect(errors).toEqual([{
      field: 'vertical_match',
      code: 'vertical_mismatch',
      message: 'Extracted content does not match the stated vertical',
    }]);
  });

  it('returns out_of_range error for values outside rules', () => {
    const data = { provider: 'Vattenfall', monthly_rate: -5, contract_start: '2026-01-01' };
    const rules = { monthly_rate: { min: 0, max: 500 } };
    const errors = validateExtractedData(data, requiredFields, rules);
    expect(errors).toEqual([{ field: 'monthly_rate', code: 'out_of_range', message: "Field 'monthly_rate' value -5 is outside allowed range [0, 500]" }]);
  });
});

describe('validateAndScore', () => {
  it('all valid + confidence=90 → no review', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 50, contract_start: '2026-01-01' };
    const result = validateAndScore(data, 90, requiredFields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.needsReview).toBe(false);
    expect(result.value.finalConfidence).toBe(90);
    expect(result.value.validationErrors).toHaveLength(0);
  });

  it('missing field → review required', () => {
    const data = { provider: 'Vattenfall', contract_start: '2026-01-01' };
    const result = validateAndScore(data, 90, requiredFields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.needsReview).toBe(true);
    expect(result.value.validationErrors.length).toBeGreaterThan(0);
  });

  it('confidence=75 → review required even with valid fields', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 50, contract_start: '2026-01-01' };
    const result = validateAndScore(data, 75, requiredFields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.needsReview).toBe(true);
    expect(result.value.finalConfidence).toBe(75);
    expect(result.value.validationErrors).toHaveLength(0);
  });

  it('confidence exactly 80 → no review', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 50, contract_start: '2026-01-01' };
    const result = validateAndScore(data, 80, requiredFields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.needsReview).toBe(false);
    expect(result.value.finalConfidence).toBe(80);
  });

  it('returns contract data unchanged', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 50, contract_start: '2026-01-01', extra: 'field' };
    const result = validateAndScore(data, 90, requiredFields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contractData).toBe(data);
  });

  it('returns confidence adjustments from scoring', () => {
    const data = { provider: 'Vattenfall', contract_start: '2026-01-01' };
    const result = validateAndScore(data, 90, requiredFields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confidenceAdjustments.length).toBeGreaterThan(0);
    expect(result.value.finalConfidence).toBe(75);
  });
});
