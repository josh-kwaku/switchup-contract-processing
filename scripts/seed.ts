import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../src/infrastructure/db/client.js';
import { logger } from '../src/infrastructure/logger.js';
import { verticals, providers, providerConfigs } from '../src/infrastructure/db/schema.js';

const VERTICALS = [
  {
    slug: 'energy',
    displayName: 'Energy',
    defaultPromptName: 'contract-extraction-energy',
    baseRequiredFields: ['provider', 'tariff_name', 'monthly_rate', 'contract_start', 'contract_end', 'kwh_price', 'cancellation_period'],
  },
  {
    slug: 'telco',
    displayName: 'Telco',
    defaultPromptName: 'contract-extraction-telco',
    baseRequiredFields: ['provider', 'plan_name', 'monthly_rate', 'contract_start', 'contract_end', 'data_volume', 'cancellation_period'],
  },
  {
    slug: 'insurance',
    displayName: 'Insurance',
    defaultPromptName: 'contract-extraction-insurance',
    baseRequiredFields: ['provider', 'policy_type', 'monthly_premium', 'contract_start', 'contract_end', 'coverage_amount', 'deductible'],
  },
];

interface ProviderSeed {
  slug: string;
  displayName: string;
  verticalSlug: string;
  configs: Array<{
    productType: string;
    requiredFields?: string[];
    validationRules?: Record<string, unknown>;
    langfusePromptName?: string;
  }>;
}

const PROVIDERS: ProviderSeed[] = [
  {
    slug: 'vattenfall',
    displayName: 'Vattenfall',
    verticalSlug: 'energy',
    configs: [
      {
        productType: 'default',
        validationRules: { monthly_rate: { min: 30, max: 500 }, kwh_price: { min: 0.1, max: 1.0 } },
      },
    ],
  },
  {
    slug: 'eon',
    displayName: 'E.ON',
    verticalSlug: 'energy',
    configs: [
      {
        productType: 'default',
        validationRules: { monthly_rate: { min: 25, max: 600 }, kwh_price: { min: 0.1, max: 1.0 } },
      },
    ],
  },
  {
    slug: 'deutsche-telekom',
    displayName: 'Deutsche Telekom',
    verticalSlug: 'telco',
    configs: [
      {
        productType: 'default',
        validationRules: { monthly_rate: { min: 10, max: 200 }, data_volume: { min: 1, max: 999 } },
      },
    ],
  },
  {
    slug: 'allianz',
    displayName: 'Allianz',
    verticalSlug: 'insurance',
    configs: [
      {
        productType: 'default',
        requiredFields: ['provider', 'policy_type', 'monthly_premium', 'contract_start', 'contract_end', 'coverage_amount', 'deductible', 'policy_number'],
        validationRules: { monthly_premium: { min: 10, max: 2000 }, coverage_amount: { min: 1000, max: 10000000 } },
      },
    ],
  },
];

async function main() {
  logger.info('Starting database seed');

  const db = createDatabase();

  try {
    const verticalRows = await db
      .insert(verticals)
      .values(VERTICALS)
      .onConflictDoNothing({ target: verticals.slug })
      .returning({ id: verticals.id, slug: verticals.slug });

    const existingVerticals = verticalRows.length > 0
      ? verticalRows
      : await db.select({ id: verticals.id, slug: verticals.slug }).from(verticals);

    const verticalMap = new Map(existingVerticals.map((v) => [v.slug, v.id]));
    logger.info({ verticals: existingVerticals.map((v) => v.slug) }, 'Verticals seeded');

    for (const p of PROVIDERS) {
      const verticalId = verticalMap.get(p.verticalSlug);
      if (!verticalId) {
        logger.warn({ provider: p.slug, vertical: p.verticalSlug }, 'Vertical not found, skipping provider');
        continue;
      }

      const providerRows = await db
        .insert(providers)
        .values({ slug: p.slug, displayName: p.displayName, verticalId })
        .onConflictDoNothing({ target: providers.slug })
        .returning({ id: providers.id, slug: providers.slug });

      let providerId: string;
      if (providerRows.length > 0) {
        providerId = providerRows[0].id;
      } else {
        const existing = await db.select({ id: providers.id }).from(providers).where(sql`slug = ${p.slug}`);
        if (!existing.length) {
          logger.warn({ provider: p.slug }, 'Provider not found after insert, skipping configs');
          continue;
        }
        providerId = existing[0].id;
      }

      for (const config of p.configs) {
        await db
          .insert(providerConfigs)
          .values({
            providerId,
            productType: config.productType,
            requiredFields: config.requiredFields ?? null,
            validationRules: config.validationRules ?? null,
            langfusePromptName: config.langfusePromptName ?? null,
          })
          .onConflictDoNothing();
      }

      logger.info({ provider: p.slug, configs: p.configs.length }, 'Provider seeded');
    }

    logger.info('Seed completed successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, step: 'seed' }, 'Seed failed');
    process.exit(1);
  }
}

main();
