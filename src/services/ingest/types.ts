export interface IngestInput {
  pdfBase64: string;
  workflowId: string;
  filename?: string;
}

export interface IngestResult {
  pdfStoragePath: string;
  pdfText: string;
}