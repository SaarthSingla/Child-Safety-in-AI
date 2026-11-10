import type { CompiledPolicy, PolicyEnvelope, Rule } from '@/policy';

export type CedarEntry = { set: 'hide' | 'ask'; id: string; text: string };

// The Cedar policies the phone actually runs, straight from the signed
// bundle. With a rule, only the policies generated from that rule
// (ids are layer__ruleid__match or layer__ruleid__unknown).
export function cedarEntries(compiled: CompiledPolicy, rule?: Pick<Rule, 'layer' | 'id'>): CedarEntry[] {
  const prefix = rule ? `${rule.layer}__${rule.id}__` : null;
  return (['hide', 'ask'] as const).flatMap((set) =>
    Object.entries(compiled[set])
      .filter(([id]) => (prefix ? id.startsWith(prefix) : true))
      .map(([id, text]) => ({ set, id, text })),
  );
}

export function cedarText(entries: CedarEntry[]): string {
  return entries.map((entry) => `// ${entry.set} set · ${entry.id}\n${entry.text.trim()}`).join('\n\n');
}

// What the screen shows as JSON: the rule itself, or the whole signed policy
// without the signatures, which are long and not meant to be read.
export function jsonText(envelope: PolicyEnvelope, rule?: Rule): string {
  if (rule) return JSON.stringify(rule, null, 2);
  const { policy, generator_version } = envelope.bundle;
  return JSON.stringify(
    { bundle_hash: envelope.bundle_hash, issued_at: envelope.issued_at, expires_at: envelope.expires_at, generator_version, policy },
    null,
    2,
  );
}
