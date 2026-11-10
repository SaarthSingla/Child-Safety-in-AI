import * as cedar from '@cedar-policy/cedar-wasm/nodejs';

import { CEDAR_SCHEMA } from './generate';
import { cedarAttributes } from './normalize';
import type { CompiledPolicy, EngineRequest, EngineResult, PolicyEngine } from './types';

// Real Cedar for the server and tests. Not copied to the wallet, which runs
// the same Cedar build inside a sealed WebView.
const child = { type: 'Child', id: 'child' };
const view = { type: 'Action', id: 'view' };

function one(policies: Record<string, string>, { record, context }: EngineRequest): EngineResult {
  const resource = { type: 'Content', id: 'item' };
  const answer = cedar.isAuthorized({
    principal: child,
    action: view,
    resource,
    context,
    validateRequest: false,
    policies: { staticPolicies: policies },
    entities: [
      { uid: resource, attrs: cedarAttributes(record) as never, parents: [] },
      { uid: child, attrs: {}, parents: [] },
    ],
  } as never);

  if (answer.type !== 'success') return { denied: false, reasons: [], errors: 1 };
  const { decision, diagnostics } = answer.response;
  return { denied: decision === 'deny', reasons: diagnostics.reason, errors: diagnostics.errors.length };
}

export const nodeEngine: PolicyEngine = {
  async authorize(policies, requests) {
    return requests.map((request) => one(policies, request));
  },
};

// Strict Cedar validation of generated rules. Returns the problems found.
export function validateCedar(compiled: CompiledPolicy): string[] {
  const problems: string[] = [];
  for (const policies of [compiled.hide, compiled.ask]) {
    const result = cedar.validate({
      validationSettings: { mode: 'strict' },
      schema: CEDAR_SCHEMA as never,
      policies: { staticPolicies: policies },
    } as never);
    if (result.type !== 'success') {
      problems.push(JSON.stringify(result.errors));
    } else {
      problems.push(...result.validationErrors.map((issue: { policyId: string; error: { message: string } }) => `${issue.policyId}: ${issue.error.message}`));
    }
  }
  return problems;
}
