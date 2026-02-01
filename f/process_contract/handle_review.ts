import * as wmill from "windmill-client@1";

export async function main(
  workflowId: string,
  action: "approve" | "reject" | "correct",
  correctedData?: Record<string, unknown>,
  notes?: string,
) {
  const serviceUrl = await wmill.getVariable("f/process_contract/SERVICE_URL");

  const res = await fetch(`${serviceUrl}/workflows/${workflowId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, correctedData, notes }),
  });

  const body = await res.json();
  if (!body.success) throw new Error(`Review failed (HTTP ${res.status}): ${body.error?.message ?? "unknown error"}`);
  return body.data;
}
