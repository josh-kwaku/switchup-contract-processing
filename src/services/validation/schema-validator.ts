import type { ValidationRules } from '../../domain/types.js';
import type { ValidationError } from './types.js';

export function validateExtractedData(
  extractedData: Record<string, unknown>,
  requiredFields: string[],
  validationRules?: ValidationRules,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (extractedData.vertical_match === false) {
    errors.push({
      field: 'vertical_match',
      code: 'vertical_mismatch',
      message: 'Extracted content does not match the stated vertical',
    });
  }

  for (const field of requiredFields) {
    if (!(field in extractedData)) {
      errors.push({ field, code: 'missing_field', message: `Required field '${field}' is missing` });
    } else if (
      extractedData[field] === null ||
      extractedData[field] === '' ||
      extractedData[field] === undefined
    ) {
      errors.push({ field, code: 'empty_field', message: `Required field '${field}' is empty` });
    }
  }

  if (validationRules) {
    for (const [field, rule] of Object.entries(validationRules)) {
      const value = extractedData[field];
      if (typeof value !== 'number') continue;

      if ((rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max)) {
        errors.push({
          field,
          code: 'out_of_range',
          message: `Field '${field}' value ${value} is outside allowed range [${rule.min ?? '-∞'}, ${rule.max ?? '∞'}]`,
        });
      }
    }
  }

  return errors;
}
