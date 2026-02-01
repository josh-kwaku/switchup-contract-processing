import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  numeric,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const verticals = pgTable('verticals', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').unique().notNull(),
  displayName: text('display_name').notNull(),
  defaultPromptName: text('default_prompt_name').notNull(),
  baseRequiredFields: text('base_required_fields').array().notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const providers = pgTable(
  'providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').unique().notNull(),
    displayName: text('display_name').notNull(),
    verticalId: uuid('vertical_id')
      .notNull()
      .references(() => verticals.id),
    metadata: jsonb('metadata').notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_providers_vertical').on(table.verticalId)],
);

export const providerConfigs = pgTable(
  'provider_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id),
    productType: text('product_type').notNull().default('default'),
    requiredFields: text('required_fields').array(),
    validationRules: jsonb('validation_rules'),
    langfusePromptName: text('langfuse_prompt_name'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_provider_configs_provider_product').on(
      table.providerId,
      table.productType,
    ),
    index('idx_provider_configs_provider').on(table.providerId),
  ],
);

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    verticalId: uuid('vertical_id')
      .notNull()
      .references(() => verticals.id),
    providerId: uuid('provider_id').references(() => providers.id),
    pdfStoragePath: text('pdf_storage_path').notNull(),
    pdfFilename: text('pdf_filename'),
    state: text('state').notNull().default('pending'),
    windmillJobId: text('windmill_job_id'),
    retryCount: integer('retry_count').notNull().default(0),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflows_state').on(table.state),
    index('idx_workflows_vertical').on(table.verticalId),
  ],
);

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    verticalId: uuid('vertical_id')
      .notNull()
      .references(() => verticals.id),
    providerId: uuid('provider_id').references(() => providers.id),
    extractedData: jsonb('extracted_data').notNull(),
    llmConfidence: numeric('llm_confidence', { precision: 5, scale: 2 }).notNull(),
    finalConfidence: numeric('final_confidence', { precision: 5, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_contracts_workflow').on(table.workflowId)],
);

export const reviewTasks = pgTable(
  'review_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    status: text('status').notNull().default('pending'),
    correctedData: jsonb('corrected_data'),
    reviewerNotes: text('reviewer_notes'),
    timeoutAt: timestamp('timeout_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_review_tasks_pending').on(table.status).where(sql`status = 'pending'`),
    index('idx_review_tasks_timeout').on(table.timeoutAt).where(sql`status = 'pending'`),
    check('review_tasks_status_check', sql`status IN ('pending', 'approved', 'rejected', 'corrected', 'timed_out')`),
  ],
);

export const workflowStateLog = pgTable(
  'workflow_state_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_workflow_state_log_workflow').on(table.workflowId)],
);
