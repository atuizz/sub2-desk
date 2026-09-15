export const opsPlatforms = [
  ['openai', 'OpenAI'], ['anthropic', 'Claude'], ['gemini', 'Gemini'],
  ['antigravity', 'Antigravity'], ['grok', 'Grok'], ['deepseek', 'DeepSeek'],
  ['kimi', 'Kimi'], ['zhipu', '智谱 GLM'], ['minimax', 'MiniMax'],
] as const;
export function optionalGroupId(value: string | number): number | undefined {
  if (typeof value === 'string' && !value.trim()) return undefined;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('分组编号须为正整数');
  return id;
}
