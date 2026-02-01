import * as wmill from "windmill-client@1";

export async function main(workflowId: string) {
  const serviceUrl = await wmill.getVariable("f/process_contract/SERVICE_URL");

  const res = await fetch(`${serviceUrl}/workflows/${workflowId}/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const body = await res.json();
  if (!body.success) throw new Error(`Compare failed (HTTP ${res.status}): ${body.error?.message ?? "unknown error"}`);
  return body.data;
}
