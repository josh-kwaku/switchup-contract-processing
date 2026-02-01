export interface CreateContractInput {
  workflowId: string;
  verticalId: string;
  providerId?: string;
  extractedData: Record<string, unknown>;
  llmConfidence: number;
  finalConfidence: number;
}

export interface UpdateContractDataInput {
  extractedData: Record<string, unknown>;
  finalConfidence: number;
}
