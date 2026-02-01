export interface MergedConfig {
  promptName: string;
  requiredFields: string[];
  validationRules: Record<string, unknown>;
}
