import { describe, it, expect } from 'vitest';
import { logger, createWorkflowLogger } from '../../src/infrastructure/logger.js';

describe('logger', () => {
  it('has service name configured', () => {
    expect((logger as any).bindings().name).toBe('contract-processing');
  });
});

describe('createWorkflowLogger', () => {
  it('creates child logger with workflowId', () => {
    const child = createWorkflowLogger('wf-123');
    const bindings = (child as any).bindings();
    expect(bindings.workflowId).toBe('wf-123');
  });

  it('includes vertical and provider when provided', () => {
    const child = createWorkflowLogger('wf-123', 'energy', 'vattenfall');
    const bindings = (child as any).bindings();
    expect(bindings.workflowId).toBe('wf-123');
    expect(bindings.vertical).toBe('energy');
    expect(bindings.provider).toBe('vattenfall');
  });

  it('omits vertical and provider when not provided', () => {
    const child = createWorkflowLogger('wf-123');
    const bindings = (child as any).bindings();
    expect(bindings.vertical).toBeUndefined();
    expect(bindings.provider).toBeUndefined();
  });
});
