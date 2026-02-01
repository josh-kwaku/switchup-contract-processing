import {
  getDb,
  getVerticalBySlug,
  createWorkflow,
  updatePdfPath,
} from "./lib.ts";

export async function main(
  pdfBase64: string,
  verticalSlug: string,
  filename?: string,
) {
  if (!pdfBase64 || !verticalSlug) {
    throw new Error("pdfBase64 and verticalSlug are required");
  }

  const db = await getDb();
  const vertical = await getVerticalBySlug(db, verticalSlug);

  const workflow = await createWorkflow(db, {
    verticalId: vertical.id,
    pdfStoragePath: "",
    pdfFilename: filename,
  });

  // Store PDF as base64 in a simple path (filesystem storage skipped in Windmill context)
  const storagePath = `windmill://${workflow.id}/${filename ?? "contract.pdf"}`;
  await updatePdfPath(db, workflow.id, storagePath);

  console.log(`Workflow created: ${workflow.id} for vertical: ${verticalSlug}`);

  return {
    workflowId: workflow.id,
    verticalSlug,
    pdfBase64,
  };
}
