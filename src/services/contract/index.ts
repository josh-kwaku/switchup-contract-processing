import { ok, err, type Result } from '../../domain/result.js';
import { createAppError, type AppError } from '../../domain/errors.js';
import { logger } from '../../infrastructure/logger.js';
import type { Contract } from '../../domain/types.js';
import type { CreateContractInput, UpdateContractDataInput } from './types.js';
import {
  insertContract,
  findContractById,
  findContractByWorkflowId,
  updateContractData as updateContractDataRepo,
} from './repository.js';

export type { CreateContractInput, UpdateContractDataInput } from './types.js';

export async function createContract(
  input: CreateContractInput,
): Promise<Result<Contract, AppError>> {
  try {
    const contract = await insertContract(input);

    logger.info(
      { workflowId: input.workflowId, contractId: contract.id, finalConfidence: input.finalConfidence },
      'Contract created',
    );
    return ok(contract);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId: input.workflowId, errorCode: 'DB_CONNECTION_ERROR', retryable: true, details: message }, 'Failed to create contract');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to create contract', true, message),
    );
  }
}

export async function getContract(
  contractId: string,
): Promise<Result<Contract, AppError>> {
  try {
    const contract = await findContractById(contractId);

    if (!contract) {
      return err(
        createAppError('CONTRACT_NOT_FOUND', `Contract '${contractId}' not found`, false),
      );
    }

    return ok(contract);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ contractId, errorCode: 'DB_CONNECTION_ERROR', retryable: true, details: message }, 'Failed to fetch contract');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to fetch contract', true, message),
    );
  }
}

export async function getContractByWorkflowId(
  workflowId: string,
): Promise<Result<Contract, AppError>> {
  try {
    const contract = await findContractByWorkflowId(workflowId);

    if (!contract) {
      return err(
        createAppError('CONTRACT_NOT_FOUND', `No contract found for workflow '${workflowId}'`, false),
      );
    }

    return ok(contract);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId, errorCode: 'DB_CONNECTION_ERROR', retryable: true, details: message }, 'Failed to fetch contract by workflow');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to fetch contract', true, message),
    );
  }
}

export async function updateContractData(
  contractId: string,
  input: UpdateContractDataInput,
): Promise<Result<Contract, AppError>> {
  try {
    const updated = await updateContractDataRepo(contractId, input);

    if (!updated) {
      return err(
        createAppError('CONTRACT_NOT_FOUND', `Contract '${contractId}' not found`, false),
      );
    }

    logger.info(
      { contractId, finalConfidence: input.finalConfidence },
      'Contract data updated',
    );
    return ok(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ contractId, errorCode: 'DB_CONNECTION_ERROR', retryable: true, details: message }, 'Failed to update contract data');
    return err(
      createAppError('DB_CONNECTION_ERROR', 'Failed to update contract data', true, message),
    );
  }
}
