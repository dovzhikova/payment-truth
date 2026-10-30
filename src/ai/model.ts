// OpenRouter chat completions over plain fetch. The key is read by the
// caller from .env and only ever sent to openrouter.ai.

import type { ChatMessage, ModelFn } from './diagnose.ts';

export const DEFAULT_MODEL = 'anthropic/claude-opus-5.5';

export function openRouterModel(apiKey: string, model = DEFAULT_MODEL, fetchFn: typeof fetch = fetch): ModelFn {
  return async (messages: ChatMessage[]) => {
    const res = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Payment Truth' },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 12000, usage: { include: true } }),
    });
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { cost?: number };
      model?: string;
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${json.error?.message ?? 'request failed'}`);
    return { text: json.choices?.[0]?.message?.content ?? '', costUsd: json.usage?.cost, model: json.model };
  };
}
