import type { Database } from '../../infrastructure/db/client.js';
import { ok, err, type Result } from '../../domain/result.js';
import { createAppError, type AppError } from '../../domain/errors.js';
import { logger } from '../../infrastructure/logger.js';
import type { Vertical, Provider } from '../../domain/types.js';
import type { MergedConfig } from './types.js';
import {
  findVerticalBySlug,
  findVerticalById,
  findProviderBySlug,
  findActiveProviderConfig,
} from './repository.js';

export type { MergedConfig } from './types.js';

export async function getVertical(
  db: Database,
  slug: string,
): Promise<Result<Vertical, AppError>> {
  try {
    const vertical = await findVerticalBySlug(db, slug);

    if (!vertical) {
      logger.warn({ slug }, 'Vertical not found');
      return err(
        createAppError('PROVIDER_NOT_FOUND', `Vertical '${slug}' not found`, false),
      );
    }

    return ok(vertical);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ slug, error: message }, 'Failed to fetch vertical');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to fetch vertical', true, message),
    );
  }
}

export async function findProvider(
  db: Database,
  slug: string,
  verticalId: string,
): Promise<Result<Provider | null, AppError>> {
  try {
    const provider = await findProviderBySlug(db, slug, verticalId);

    if (!provider) {
      logger.debug({ slug, verticalId }, 'Provider not found');
    }

    return ok(provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ slug, verticalId, error: message }, 'Failed to fetch provider');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to fetch provider', true, message),
    );
  }
}

export async function getMergedConfig(
  db: Database,
  verticalId: string,
  providerId?: string,
): Promise<Result<MergedConfig, AppError>> {
  try {
    const vertical = await findVerticalById(db, verticalId);

    if (!vertical) {
      return err(
        createAppError('PROVIDER_NOT_FOUND', `Vertical with id '${verticalId}' not found`, false),
      );
    }

    const baseConfig: MergedConfig = {
      promptName: vertical.defaultPromptName,
      requiredFields: vertical.baseRequiredFields,
      validationRules: {},
    };

    if (!providerId) {
      logger.debug({ verticalId }, 'No provider specified, using vertical defaults');
      return ok(baseConfig);
    }

    const config = await findActiveProviderConfig(db, providerId);

    if (!config) {
      logger.debug({ verticalId, providerId }, 'No provider config found, using vertical defaults');
      return ok(baseConfig);
    }

    return ok({
      promptName: config.langfusePromptName ?? vertical.defaultPromptName,
      requiredFields: config.requiredFields ?? vertical.baseRequiredFields,
      validationRules: config.validationRules ?? {},
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ verticalId, providerId, error: message }, 'Failed to get merged config');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to get merged config', true, message),
    );
  }
}
