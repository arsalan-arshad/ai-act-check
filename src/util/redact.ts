const MIN_SECRET_LENGTH = 8;

/** Replaces every occurrence of the configured LLM API key in `text`. Too-short values are ignored to avoid mangling output. */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv): string {
  const key = env.LLM_API_KEY;
  if (key === undefined || key.length < MIN_SECRET_LENGTH) return text;
  return text.split(key).join('[redacted]');
}
