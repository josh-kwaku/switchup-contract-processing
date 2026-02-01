export const WORKFLOW_STATES = [
  'pending',
  'parsing_pdf',
  'extracting',
  'validating',
  'review_required',
  'validated',
  'comparing',
  'completed',
  'rejected',
  'timed_out',
  'failed',
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const REVIEW_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'corrected',
  'timed_out',
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface Vertical {
  id: string;
  slug: string;
  displayName: string;
  defaultPromptName: string;
  baseRequiredFields: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Provider {
  id: string;
  slug: string;
  displayName: string;
  verticalId: string;
  metadata: Record<string, unknown>;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderConfig {
  id: string;
  providerId: string;
  productType: string;
  requiredFields: string[] | null;
  validationRules: Record<string, unknown> | null;
  langfusePromptName: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Workflow {
  id: string;
  verticalId: string;
  providerId: string | null;
  pdfStoragePath: string;
  pdfFilename: string | null;
  state: WorkflowState;
  windmillJobId: string | null;
  retryCount: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Contract {
  id: string;
  workflowId: string;
  verticalId: string;
  providerId: string | null;
  extractedData: Record<string, unknown>;
  llmConfidence: number;
  finalConfidence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewTask {
  id: string;
  workflowId: string;
  contractId: string;
  status: ReviewStatus;
  correctedData: Record<string, unknown> | null;
  reviewerNotes: string | null;
  timeoutAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredPdf {
  path: string;
  sizeBytes: number;
}

export interface WorkflowStateLog {
  id: string;
  workflowId: string;
  fromState: WorkflowState | null;
  toState: WorkflowState;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
