import { getDb, getVerticalBySlug } from "./lib.ts";
import { Langfuse } from "langfuse";
import Groq from "groq-sdk";
import * as wmill from "windmill-client@1";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export async function main(pdfText: string, workflowId: string, verticalSlug: string) {
  const db = await getDb();
  const vertical = await getVerticalBySlug(db, verticalSlug);

  // Initialize Langfuse
  const langfusePublicKey = await wmill.getVariable("u/kwakujosh/LANGFUSE_PUBLIC_KEY");
  const langfuseSecretKey = await wmill.getVariable("u/kwakujosh/LANGFUSE_SECRET_KEY");
  const langfuseBaseUrl = await wmill.getVariable("u/kwakujosh/LANGFUSE_BASE_URL");

  const langfuse = new Langfuse({
    publicKey: langfusePublicKey,
    secretKey: langfuseSecretKey,
    baseUrl: langfuseBaseUrl ?? "https://cloud.langfuse.com",
  });

  // Fetch prompt from Langfuse
  const promptObj = await langfuse.getPrompt(vertical.defaultPromptName, undefined, {
    label: "production",
    type: "text",
  });

  const systemPrompt = promptObj.prompt
    .replace("{{contract_text}}", pdfText)
    .replace("{{vertical}}", vertical.slug);

  // Call Groq
  const groqApiKey = await wmill.getVariable("u/kwakujosh/GROQ_API_KEY");
  const groq = new Groq({ apiKey: groqApiKey });

  const startTime = Date.now();
  const response = await groq.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: pdfText },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });

  const latencyMs = Date.now() - startTime;
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Groq returned empty response");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Groq returned invalid JSON");
  }

  const llmConfidence =
    typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 100
      ? parsed.confidence
      : 0;

  // Trace to Langfuse (fire-and-forget)
  try {
    const trace = langfuse.trace({ id: workflowId, name: `extraction-${vertical.slug}` });
    trace.generation({
      name: `extraction-${vertical.slug}`,
      model: response.model,
      input: systemPrompt,
      output: content,
      startTime: new Date(Date.now() - latencyMs),
      endTime: new Date(),
    });
  } catch {
    console.warn("Failed to trace to Langfuse (non-blocking)");
  }

  console.log(`Extraction complete: model=${response.model}, confidence=${llmConfidence}, latency=${latencyMs}ms`);

  return {
    extractionResult: {
      extractedData: parsed,
      llmConfidence,
      rawResponse: content,
      model: response.model,
      latencyMs,
    },
    workflowId,
    verticalId: vertical.id,
    requiredFields: vertical.baseRequiredFields,
  };
}
