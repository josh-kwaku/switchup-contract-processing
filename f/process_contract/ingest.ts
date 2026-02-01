import * as wmill from "windmill-client@1";

export async function main(pdfBase64: string, verticalSlug: string, filename?: string) {
  const serviceUrl = await wmill.getVariable("f/process_contract/SERVICE_URL");

  const res = await fetch(`${serviceUrl}/workflows/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdfBase64, verticalSlug, filename }),
  });

  const body = await res.json();
  if (!body.success) throw new Error(`Ingest failed (HTTP ${res.status}): ${body.error?.message ?? "unknown error"}`);
  return body.data;
}
