import { eq, and } from 'drizzle-orm';
import { getDb } from '../../infrastructure/db/client.js';
import { verticals, providers, providerConfigs } from '../../infrastructure/db/schema.js';
import type { Vertical, Provider, ProviderConfig } from '../../domain/types.js';

function toVertical(row: typeof verticals.$inferSelect): Vertical {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    defaultPromptName: row.defaultPromptName,
    baseRequiredFields: row.baseRequiredFields,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProvider(row: typeof providers.$inferSelect): Provider {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    verticalId: row.verticalId,
    metadata: row.metadata as Record<string, unknown>,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProviderConfig(row: typeof providerConfigs.$inferSelect): ProviderConfig {
  return {
    id: row.id,
    providerId: row.providerId,
    productType: row.productType,
    requiredFields: row.requiredFields,
    validationRules: (row.validationRules ?? null) as Record<string, unknown> | null,
    langfusePromptName: row.langfusePromptName,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findVerticalBySlug(
  slug: string,
): Promise<Vertical | null> {
  const rows = await getDb()
    .select()
    .from(verticals)
    .where(and(eq(verticals.slug, slug), eq(verticals.active, true)));

  return rows.length > 0 ? toVertical(rows[0]) : null;
}

export async function findVerticalById(
  id: string,
): Promise<Vertical | null> {
  const rows = await getDb()
    .select()
    .from(verticals)
    .where(eq(verticals.id, id));

  return rows.length > 0 ? toVertical(rows[0]) : null;
}

export async function findProviderBySlug(
  slug: string,
  verticalId: string,
): Promise<Provider | null> {
  const rows = await getDb()
    .select()
    .from(providers)
    .where(
      and(
        eq(providers.slug, slug),
        eq(providers.verticalId, verticalId),
        eq(providers.active, true),
      ),
    );

  return rows.length > 0 ? toProvider(rows[0]) : null;
}

export async function findActiveProviderConfig(
  providerId: string,
): Promise<ProviderConfig | null> {
  const rows = await getDb()
    .select()
    .from(providerConfigs)
    .where(
      and(
        eq(providerConfigs.providerId, providerId),
        eq(providerConfigs.active, true),
      ),
    );

  return rows.length > 0 ? toProviderConfig(rows[0]) : null;
}
