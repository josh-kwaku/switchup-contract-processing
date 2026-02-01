import type { WorkflowState } from '../../domain/types.js';

export interface CreateWorkflowInput {
  verticalId: string;
  pdfStoragePath: string;
  pdfFilename?: string;
}

export interface TransitionMetadata {
  errorCode?: string;
  errorMessage?: string;
  failedAtStep?: WorkflowState;
  retryAttempt?: number;
  triggeredBy?: string;
  [key: string]: unknown;
}

const TERMINAL_STATES: ReadonlySet<WorkflowState> = new Set([
  'completed',
  'rejected',
  'timed_out',
]);

export function isTerminalState(state: WorkflowState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Valid state transitions derived from the technical design state machine.
 * Key = from state, Value = set of allowed target states.
 */
export const VALID_TRANSITIONS: Record<WorkflowState, ReadonlySet<WorkflowState>> = {
  pending: new Set<WorkflowState>(['parsing_pdf']),
  parsing_pdf: new Set<WorkflowState>(['extracting', 'failed']),
  extracting: new Set<WorkflowState>(['validating', 'failed']),
  validating: new Set<WorkflowState>(['validated', 'review_required', 'failed']),
  review_required: new Set<WorkflowState>(['validated', 'rejected', 'timed_out']),
  validated: new Set<WorkflowState>(['comparing']),
  comparing: new Set<WorkflowState>(['completed', 'failed']),
  failed: new Set<WorkflowState>([
    'parsing_pdf',
    'extracting',
    'validating',
    'comparing',
    'rejected',
  ]),
  completed: new Set<WorkflowState>(),
  rejected: new Set<WorkflowState>(),
  timed_out: new Set<WorkflowState>(),
};
