import { getDb, transitionState } from "./lib.ts";

export async function main(pdfBase64: string, workflowId: string) {
  const db = await getDb();

  await transitionState(db, workflowId, "parsing_pdf");

  const buffer = Buffer.from(pdfBase64, "base64");

  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(buffer));

  // extractText returns { text, totalPages } but text may not be a string directly
  const pdfText = String(result.text ?? "").trim();
  if (pdfText.length === 0) {
    throw new Error("PDF contains no extractable text");
  }

  await transitionState(db, workflowId, "extracting");

  console.log(`PDF parsed: ${pdfText.length} chars`);

  return { pdfText, workflowId };
}
