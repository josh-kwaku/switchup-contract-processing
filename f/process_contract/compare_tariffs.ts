import { getDb, transitionState } from "./lib.ts";

export async function main(workflowId: string, contractId: string) {
  const db = await getDb();

  await transitionState(db, workflowId, "comparing");

  // Mock tariff comparison — demonstrates extensibility point
  const comparison = {
    potentialSavingsEur: Math.round(Math.random() * 200 + 50),
    recommendation: "Switch to SwitchUp Green Tariff for lower rates",
    comparedAt: new Date().toISOString(),
  };

  console.log(`Tariff comparison complete (mock): savings=${comparison.potentialSavingsEur}EUR`);

  await transitionState(db, workflowId, "completed");

  return { comparison, workflowId };
}
