import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getVertical, findProvider, getMergedConfig } from '../../src/services/provider-registry/index.js';
import type { Database } from '../../src/infrastructure/db/client.js';
import type { Vertical, Provider, ProviderConfig } from '../../src/domain/types.js';

vi.mock('../../src/services/provider-registry/repository.js', () => ({
  findVerticalBySlug: vi.fn(),
  findVerticalById: vi.fn(),
  findProviderBySlug: vi.fn(),
  findActiveProviderConfig: vi.fn(),
}));

import {
  findVerticalBySlug,
  findVerticalById,
  findProviderBySlug,
  findActiveProviderConfig,
} from '../../src/services/provider-registry/repository.js';

const db = {} as Database;

const ENERGY_VERTICAL: Vertical = {
  id: 'vert-1',
  slug: 'energy',
  displayName: 'Energy',
  defaultPromptName: 'contract-extraction-energy',
  baseRequiredFields: ['provider', 'tariff_name', 'monthly_rate'],
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VATTENFALL_PROVIDER: Provider = {
  id: 'prov-1',
  slug: 'vattenfall',
  displayName: 'Vattenfall',
  verticalId: 'vert-1',
  metadata: {},
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const VATTENFALL_CONFIG: ProviderConfig = {
  id: 'cfg-1',
  providerId: 'prov-1',
  productType: 'default',
  requiredFields: ['provider', 'tariff_name', 'monthly_rate', 'extra_field'],
  validationRules: { monthly_rate: { min: 30, max: 500 } },
  langfusePromptName: 'custom-prompt',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getVertical', () => {
  it('returns vertical when found', async () => {
    vi.mocked(findVerticalBySlug).mockResolvedValue(ENERGY_VERTICAL);

    const result = await getVertical(db, 'energy');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.slug).toBe('energy');
    }
  });

  it('returns error when vertical not found', async () => {
    vi.mocked(findVerticalBySlug).mockResolvedValue(null);

    const result = await getVertical(db, 'nonexistent');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_NOT_FOUND');
    }
  });

  it('returns DB error on exception', async () => {
    vi.mocked(findVerticalBySlug).mockRejectedValue(new Error('connection lost'));

    const result = await getVertical(db, 'energy');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DB_CONNECTION_ERROR');
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe('findProvider', () => {
  it('returns provider when found', async () => {
    vi.mocked(findProviderBySlug).mockResolvedValue(VATTENFALL_PROVIDER);

    const result = await findProvider(db, 'vattenfall', 'vert-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.slug).toBe('vattenfall');
    }
  });

  it('returns null when provider not found', async () => {
    vi.mocked(findProviderBySlug).mockResolvedValue(null);

    const result = await findProvider(db, 'unknown', 'vert-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });
});

describe('getMergedConfig', () => {
  it('returns vertical defaults when no provider specified', async () => {
    vi.mocked(findVerticalById).mockResolvedValue(ENERGY_VERTICAL);

    const result = await getMergedConfig(db, 'vert-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.promptName).toBe('contract-extraction-energy');
      expect(result.value.requiredFields).toEqual(['provider', 'tariff_name', 'monthly_rate']);
      expect(result.value.validationRules).toEqual({});
    }
  });

  it('returns vertical defaults when provider has no config', async () => {
    vi.mocked(findVerticalById).mockResolvedValue(ENERGY_VERTICAL);
    vi.mocked(findActiveProviderConfig).mockResolvedValue(null);

    const result = await getMergedConfig(db, 'vert-1', 'prov-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.promptName).toBe('contract-extraction-energy');
    }
  });

  it('merges provider config overrides', async () => {
    vi.mocked(findVerticalById).mockResolvedValue(ENERGY_VERTICAL);
    vi.mocked(findActiveProviderConfig).mockResolvedValue(VATTENFALL_CONFIG);

    const result = await getMergedConfig(db, 'vert-1', 'prov-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.promptName).toBe('custom-prompt');
      expect(result.value.requiredFields).toContain('extra_field');
      expect(result.value.validationRules).toEqual({ monthly_rate: { min: 30, max: 500 } });
    }
  });

  it('falls back to vertical prompt when provider prompt is null', async () => {
    vi.mocked(findVerticalById).mockResolvedValue(ENERGY_VERTICAL);
    vi.mocked(findActiveProviderConfig).mockResolvedValue({
      ...VATTENFALL_CONFIG,
      langfusePromptName: null,
      requiredFields: null,
    });

    const result = await getMergedConfig(db, 'vert-1', 'prov-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.promptName).toBe('contract-extraction-energy');
      expect(result.value.requiredFields).toEqual(['provider', 'tariff_name', 'monthly_rate']);
      expect(result.value.validationRules).toEqual({ monthly_rate: { min: 30, max: 500 } });
    }
  });

  it('returns error when vertical not found', async () => {
    vi.mocked(findVerticalById).mockResolvedValue(null);

    const result = await getMergedConfig(db, 'nonexistent-id');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PROVIDER_NOT_FOUND');
    }
  });
});
