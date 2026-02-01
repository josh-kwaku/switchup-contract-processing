import { describe, it, expect } from 'vitest';
import { computeFinalConfidence } from '../../src/services/extraction/confidence.js';

describe('computeFinalConfidence', () => {
  const requiredFields = ['provider', 'monthly_rate', 'contract_start'];

  it('returns llmScore unchanged when all fields present', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 50, contract_start: '2026-01-01', vertical_match: true };
    const result = computeFinalConfidence(85, data, requiredFields);
    expect(result.finalConfidence).toBe(85);
    expect(result.adjustments).toHaveLength(0);
  });

  it('penalizes missing required field by 15', () => {
    const data = { provider: 'Vattenfall', contract_start: '2026-01-01' };
    const result = computeFinalConfidence(85, data, requiredFields);
    expect(result.finalConfidence).toBe(70);
    expect(result.adjustments).toEqual([{ reason: 'missing_field', penalty: 15, field: 'monthly_rate' }]);
  });

  it('penalizes empty required field by 10', () => {
    const data = { provider: 'Vattenfall', monthly_rate: null, contract_start: '2026-01-01' };
    const result = computeFinalConfidence(85, data, requiredFields);
    expect(result.finalConfidence).toBe(75);
    expect(result.adjustments).toEqual([{ reason: 'empty_field', penalty: 10, field: 'monthly_rate' }]);
  });

  it('penalizes vertical mismatch by 30', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 50, contract_start: '2026-01-01', vertical_match: false };
    const result = computeFinalConfidence(85, data, requiredFields);
    expect(result.finalConfidence).toBe(55);
    expect(result.adjustments).toEqual([{ reason: 'vertical_mismatch', penalty: 30 }]);
  });

  it('stacks multiple penalties', () => {
    const data = { provider: 'Vattenfall', vertical_match: false }; // missing monthly_rate + contract_start + mismatch
    const result = computeFinalConfidence(85, data, requiredFields);
    // -30 (mismatch) -15 (monthly_rate missing) -15 (contract_start missing) = -60
    expect(result.finalConfidence).toBe(25);
    expect(result.adjustments).toHaveLength(3);
  });

  it('floors at 0', () => {
    const data = { vertical_match: true }; // all 3 fields missing = -45
    const result = computeFinalConfidence(20, data, requiredFields);
    expect(result.finalConfidence).toBe(0);
  });

  it('caps at 100', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 50, contract_start: '2026-01-01' };
    const result = computeFinalConfidence(120, data, requiredFields);
    expect(result.finalConfidence).toBe(100);
  });

  it('penalizes out-of-range values by 10', () => {
    const data = { provider: 'Vattenfall', monthly_rate: -5, contract_start: '2026-01-01' };
    const rules = { monthly_rate: { min: 0, max: 500 } };
    const result = computeFinalConfidence(85, data, requiredFields, rules);
    expect(result.finalConfidence).toBe(75);
    expect(result.adjustments).toEqual([{ reason: 'out_of_range', penalty: 10, field: 'monthly_rate' }]);
  });

  it('penalizes value above max', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 9999, contract_start: '2026-01-01' };
    const rules = { monthly_rate: { min: 0, max: 500 } };
    const result = computeFinalConfidence(85, data, requiredFields, rules);
    expect(result.finalConfidence).toBe(75);
  });

  it('skips range check for non-numeric values', () => {
    const data = { provider: 'Vattenfall', monthly_rate: 'unknown', contract_start: '2026-01-01' };
    const rules = { monthly_rate: { min: 0, max: 500 } };
    const result = computeFinalConfidence(85, data, requiredFields, rules);
    // no out_of_range penalty since value is not a number
    expect(result.finalConfidence).toBe(85);
    expect(result.adjustments).toHaveLength(0);
  });
});
