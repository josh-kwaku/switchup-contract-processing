import {
  getDb,
  transitionState,
  createContract,
  createReviewTask,
  validateAndScore,
  type ValidationResult,
} from "./lib.ts";

interface ExtractionResult {
  extractedData: Record<string, unknown>;
  llmConfidence: number;
  rawResponse: string;
  model: string;
  latencyMs: number;
}

export async function main(
  extractionResult: ExtractionResult,
  workflowId: string,
  verticalId: string,
  requiredFields: string[],
) {
  const db = await getDb();

  await transitionState(db, workflowId, "validating");

  const validationResult = validateAndScore(
    extractionResult.extractedData,
    extractionResult.llmConfidence,
    requiredFields,
  );

  const contract = await createContract(db, {
    workflowId,
    verticalId,
    extractedData: extractionResult.extractedData,
    llmConfidence: extractionResult.llmConfidence,
    finalConfidence: validationResult.finalConfidence,
  });

  const { needsReview } = validationResult;

  if (needsReview) {
    await transitionState(db, workflowId, "review_required");

    const timeoutAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await createReviewTask(db, {
      workflowId,
      contractId: contract.id,
      timeoutAt,
    });

    console.log(`Review required: confidence=${validationResult.finalConfidence}, errors=${validationResult.validationErrors.length}`);
  } else {
    await transitionState(db, workflowId, "validated");
    console.log(`Validation passed: confidence=${validationResult.finalConfidence}`);
  }

  return {
    validationResult,
    contractId: contract.id,
    needsReview,
    workflowId,
  };
}
