import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export type LlmConfig = { name: string; baseUrl: string; apiKey: string | null; model: string };

const PROVIDERS: Record<string, { baseUrl: string; model: string | null }> = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: null },
  custom: { baseUrl: '', model: null },
};

export type Config = {
  port: number;
  host: string;
  dbPath: string;
  keyPath: string;
  // The address used in pairing links, such as an https tunnel. When unset it
  // comes from each request.
  publicUrl: string | null;
  llm: LlmConfig | null;
  publicDir: string;
  // How long a policy stays valid on a phone without a fresh download.
  policyDays: number;
};

// NLPPS_LLM_PROVIDER   groq | ollama | custom
// NLPPS_LLM_API_KEY    the provider's API key (not needed for ollama)
// NLPPS_LLM_MODEL      overrides the provider's default model
// NLPPS_LLM_BASE_URL   overrides the provider's address (required for custom)
function loadLlm(env: NodeJS.ProcessEnv): LlmConfig | null {
  const provider = env.NLPPS_LLM_PROVIDER?.trim().toLowerCase();
  if (!provider) return null;

  const preset = PROVIDERS[provider];
  if (!preset) throw new Error(`NLPPS_LLM_PROVIDER must be one of ${Object.keys(PROVIDERS).join(', ')}`);

  const baseUrl = env.NLPPS_LLM_BASE_URL?.trim() || preset.baseUrl;
  const model = env.NLPPS_LLM_MODEL?.trim() || preset.model;
  if (!baseUrl) throw new Error('NLPPS_LLM_BASE_URL is required for this provider');
  if (!model) throw new Error('NLPPS_LLM_MODEL is required for this provider');

  return { name: `${provider}:${model}`, baseUrl, apiKey: env.NLPPS_LLM_API_KEY?.trim() || null, model };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dbPath: env.NLPPS_DB ?? join(root, 'data', 'nlpps.db'),
    keyPath: env.NLPPS_KEY ?? join(root, 'keys', 'nlpps-dev-signing.pem'),
    publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : null,
    llm: loadLlm(env),
    publicDir: join(root, 'public'),
    policyDays: Number(env.NLPPS_POLICY_DAYS ?? 7),
  };
}
