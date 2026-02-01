import * as wmill from "windmill-client@1";

export async function main(workflowId: string, pdfText: string, verticalSlug: string) {
  const serviceUrl = await wmill.getVariable("f/process_contract/SERVICE_URL");

  const res = await fetch(`${serviceUrl}/workflows/${workflowId}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdfText, verticalSlug }),
  });

  const body = await res.json();
  if (!body.success) throw new Error(`Extract failed (HTTP ${res.status}): ${body.error?.message ?? "unknown error"}`);
  return body.data;
}
