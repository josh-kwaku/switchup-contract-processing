export interface CreateReviewTaskInput {
  workflowId: string;
  contractId: string;
  timeoutAt: Date;
}

export interface ReviewCorrectionInput {
  correctedData: Record<string, unknown>;
  reviewerNotes?: string;
}
