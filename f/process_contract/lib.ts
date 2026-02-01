// Shared library for Windmill flow scripts — no main function.
// Contains DB schema, state machine, and helpers.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as wmill from "windmill-client@1";

// --- Schema ---

export const verticals = pgTable("verticals", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").unique().notNull(),
  displayName: text("display_name").notNull(),
  defaultPromptName: text("default_prompt_name").notNull(),
  baseRequiredFields: text("base_required_fields").array().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    verticalId: uuid("vertical_id").notNull(),
    providerId: uuid("provider_id"),
    pdfStoragePath: text("pdf_storage_path").notNull(),
    pdfFilename: text("pdf_filename"),
    state: text("state").notNull().default("pending"),
    windmillJobId: text("windmill_job_id"),
    retryCount: integer("retry_count").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_workflows_state").on(table.state)],
);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id").notNull(),
    verticalId: uuid("vertical_id").notNull(),
    providerId: uuid("provider_id"),
    extractedData: jsonb("extracted_data").notNull(),
    llmConfidence: numeric("llm_confidence", { precision: 5, scale: 2 }).notNull(),
    finalConfidence: numeric("final_confidence", { precision: 5, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_contracts_workflow").on(table.workflowId)],
);

export const reviewTasks = pgTable("review_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id").notNull(),
  contractId: uuid("contract_id").notNull(),
  status: text("status").notNull().default("pending"),
  correctedData: jsonb("corrected_data"),
  reviewerNotes: text("reviewer_notes"),
  timeoutAt: timestamp("timeout_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowStateLog = pgTable(
  "workflow_state_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id").notNull(),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_workflow_state_log_workflow").on(table.workflowId)],
);

const schema = { verticals, workflows, contracts, reviewTasks, workflowStateLog };

// --- Types ---

export type WorkflowState =
  | "pending"
  | "parsing_pdf"
  | "extracting"
  | "validating"
  | "review_required"
  | "validated"
  | "comparing"
  | "completed"
  | "rejected"
  | "timed_out"
  | "failed";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

// --- State Machine ---

const VALID_TRANSITIONS: Record<WorkflowState, Set<WorkflowState>> = {
  pending: new Set(["parsing_pdf"]),
  parsing_pdf: new Set(["extracting", "failed"]),
  extracting: new Set(["validating", "failed"]),
  validating: new Set(["validated", "review_required", "failed"]),
  review_required: new Set(["validated", "rejected", "timed_out"]),
  validated: new Set(["comparing"]),
  comparing: new Set(["completed", "failed"]),
  failed: new Set(["parsing_pdf", "extracting", "validating", "comparing", "rejected"]),
  completed: new Set(),
  rejected: new Set(),
  timed_out: new Set(),
};

// --- DB Connection ---

export async function getDb(): Promise<Database> {
  const dbUrl = await wmill.getVariable("u/kwakujosh/DATABASE_URL");
  const client = neon(dbUrl);
  return drizzle(client, { schema });
}

// --- Workflow Operations ---

export async function createWorkflow(
  db: Database,
  input: { verticalId: string; pdfStoragePath: string; pdfFilename?: string },
) {
  const rows = await db
    .insert(workflows)
    .values({
      verticalId: input.verticalId,
      pdfStoragePath: input.pdfStoragePath,
      pdfFilename: input.pdfFilename ?? null,
      state: "pending",
      retryCount: 0,
    })
    .returning();

  await db.insert(workflowStateLog).values({
    workflowId: rows[0].id,
    fromState: null,
    toState: "pending",
    metadata: {},
  });

  return rows[0];
}

export async function transitionState(
  db: Database,
  workflowId: string,
  toState: WorkflowState,
  metadata?: Record<string, unknown>,
) {
  const rows = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (rows.length === 0) throw new Error(`Workflow '${workflowId}' not found`);

  const workflow = rows[0];
  const fromState = workflow.state as WorkflowState;
  const allowed = VALID_TRANSITIONS[fromState];

  if (!allowed || !allowed.has(toState)) {
    throw new Error(`Invalid state transition: '${fromState}' → '${toState}'`);
  }

  const errorMsg = toState === "failed" ? (metadata?.errorMessage as string) : undefined;
  const updated = await db
    .update(workflows)
    .set({ state: toState, errorMessage: errorMsg ?? null, updatedAt: new Date() })
    .where(eq(workflows.id, workflowId))
    .returning();

  await db.insert(workflowStateLog).values({
    workflowId,
    fromState,
    toState,
    metadata: metadata ?? {},
  });

  return updated[0];
}

export async function updatePdfPath(db: Database, workflowId: string, path: string) {
  await db
    .update(workflows)
    .set({ pdfStoragePath: path, updatedAt: new Date() })
    .where(eq(workflows.id, workflowId));
}

export async function failWorkflow(
  db: Database,
  workflowId: string,
  errorCode: string,
  errorMessage: string,
  failedAtStep: WorkflowState,
) {
  await transitionState(db, workflowId, "failed", { errorCode, errorMessage, failedAtStep });

  const rows = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  const retryCount = (rows[0]?.retryCount ?? 0) + 1;

  await db
    .update(workflows)
    .set({ retryCount, updatedAt: new Date() })
    .where(eq(workflows.id, workflowId));

  if (retryCount >= 3) {
    await transitionState(db, workflowId, "rejected", {
      triggeredBy: "max_retries_exceeded",
      retryCount,
    });
  }
}

// --- Vertical Lookup ---

export async function getVerticalBySlug(db: Database, slug: string) {
  const rows = await db.select().from(verticals).where(eq(verticals.slug, slug));
  if (rows.length === 0) throw new Error(`Vertical '${slug}' not found`);
  return rows[0];
}

// --- Contract Operations ---

export async function createContract(
  db: Database,
  input: {
    workflowId: string;
    verticalId: string;
    extractedData: Record<string, unknown>;
    llmConfidence: number;
    finalConfidence: number;
  },
) {
  const rows = await db
    .insert(contracts)
    .values({
      workflowId: input.workflowId,
      verticalId: input.verticalId,
      extractedData: input.extractedData,
      llmConfidence: String(input.llmConfidence),
      finalConfidence: String(input.finalConfidence),
    })
    .returning();

  return rows[0];
}

// --- Review Task Operations ---

export async function createReviewTask(
  db: Database,
  input: { workflowId: string; contractId: string; timeoutAt: Date },
) {
  const rows = await db
    .insert(reviewTasks)
    .values({
      workflowId: input.workflowId,
      contractId: input.contractId,
      status: "pending",
      timeoutAt: input.timeoutAt,
    })
    .returning();

  return rows[0];
}

// --- Validation ---

const CONFIDENCE_THRESHOLD = 80;

const PENALTIES = {
  MISSING_FIELD: 15,
  EMPTY_FIELD: 10,
  OUT_OF_RANGE: 10,
  VERTICAL_MISMATCH: 30,
} as const;

export interface ValidationResult {
  contractData: Record<string, unknown>;
  finalConfidence: number;
  needsReview: boolean;
  validationErrors: Array<{ field: string; code: string; message: string }>;
  confidenceAdjustments: Array<{ reason: string; penalty: number; field?: string }>;
}

export function validateAndScore(
  extractedData: Record<string, unknown>,
  llmConfidence: number,
  requiredFields: string[],
): ValidationResult {
  const validationErrors: ValidationResult["validationErrors"] = [];
  const adjustments: ValidationResult["confidenceAdjustments"] = [];

  if (extractedData.vertical_match === false) {
    validationErrors.push({
      field: "vertical_match",
      code: "vertical_mismatch",
      message: "Extracted content does not match the stated vertical",
    });
    adjustments.push({ reason: "vertical_mismatch", penalty: PENALTIES.VERTICAL_MISMATCH });
  }

  for (const field of requiredFields) {
    if (!(field in extractedData)) {
      validationErrors.push({ field, code: "missing_field", message: `Required field '${field}' is missing` });
      adjustments.push({ reason: "missing_field", penalty: PENALTIES.MISSING_FIELD, field });
    } else if (extractedData[field] === null || extractedData[field] === "" || extractedData[field] === undefined) {
      validationErrors.push({ field, code: "empty_field", message: `Required field '${field}' is empty` });
      adjustments.push({ reason: "empty_field", penalty: PENALTIES.EMPTY_FIELD, field });
    }
  }

  const totalPenalty = adjustments.reduce((sum, a) => sum + a.penalty, 0);
  const finalConfidence = Math.max(0, Math.min(100, llmConfidence - totalPenalty));
  const needsReview = finalConfidence < CONFIDENCE_THRESHOLD || validationErrors.length > 0;

  return {
    contractData: extractedData,
    finalConfidence,
    needsReview,
    validationErrors,
    confidenceAdjustments: adjustments,
  };
}
