import type { Env } from '../types'

export type LanguageTool = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export type LanguageMessage = { role: 'user' | 'assistant'; content: string }
export type RoutedLanguageTool = { name: string; input: Record<string, unknown> }

type Provider = 'anthropic' | 'openai' | 'gemini'

function configuredProviders(env: Env): Provider[] {
  const requested = String(env.NL_PROVIDER ?? 'auto').trim().toLowerCase()
  const order: Provider[] = requested === 'anthropic' || requested === 'openai' || requested === 'gemini'
    ? [requested]
    : ['anthropic', 'openai', 'gemini']
  return order.filter((provider) => {
    if (provider === 'anthropic') return Boolean(String(env.ANTHROPIC_API_KEY ?? '').trim())
    if (provider === 'openai') return Boolean(String(env.OPENAI_API_KEY ?? '').trim())
    return Boolean(String(env.GEMINI_API_KEY ?? '').trim())
  })
}

export function hasLanguageModelProvider(env: Env): boolean {
  return configuredProviders(env).length > 0
}

function modelFor(env: Env, provider: Provider): string {
  if (provider === 'anthropic') return String(env.ANTHROPIC_MODEL ?? env.NL_MODEL ?? 'claude-haiku-4-5-20251001').trim()
  if (provider === 'openai') return String(env.OPENAI_MODEL ?? env.NL_MODEL ?? 'gpt-6-luna').trim()
  return String(env.GEMINI_MODEL ?? env.NL_MODEL ?? 'gemini-3.5-flash-lite').trim()
}

async function jsonResponse(response: Response): Promise<Record<string, unknown> | undefined> {
  if (!response.ok) return undefined
  const value = await response.json().catch(() => undefined) as unknown
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

async function callAnthropic(env: Env, system: string, messages: LanguageMessage[], tools: LanguageTool[]): Promise<RoutedLanguageTool | undefined> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(8_000),
    headers: { 'content-type': 'application/json', 'x-api-key': String(env.ANTHROPIC_API_KEY), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: modelFor(env, 'anthropic'), max_tokens: 400, system, messages, tools, tool_choice: { type: 'auto' } }),
  })
  const data = await jsonResponse(response)
  const content = Array.isArray(data?.content) ? data.content as { type?: string; name?: string; input?: unknown }[] : []
  const block = content.find((part) => part.type === 'tool_use' && typeof part.name === 'string')
  return block?.name && block.input && typeof block.input === 'object' ? { name: block.name, input: block.input as Record<string, unknown> } : undefined
}

async function callOpenAi(env: Env, system: string, messages: LanguageMessage[], tools: LanguageTool[]): Promise<RoutedLanguageTool | undefined> {
  const openAiTools = tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }))
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(8_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${String(env.OPENAI_API_KEY)}` },
    body: JSON.stringify({ model: modelFor(env, 'openai'), max_tokens: 400, messages: [{ role: 'system', content: system }, ...messages], tools: openAiTools, tool_choice: 'auto', parallel_tool_calls: false }),
  })
  const data = await jsonResponse(response)
  const choices = Array.isArray(data?.choices) ? data.choices as { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] : []
  const call = choices[0]?.message?.tool_calls?.find((item) => item.function?.name)
  if (!call?.function?.name || !call.function.arguments) return undefined
  try {
    const input = JSON.parse(call.function.arguments) as unknown
    return input && typeof input === 'object' ? { name: call.function.name, input: input as Record<string, unknown> } : undefined
  } catch { return undefined }
}

async function callGemini(env: Env, system: string, messages: LanguageMessage[], tools: LanguageTool[]): Promise<RoutedLanguageTool | undefined> {
  const declarations = tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.input_schema }))
  const contents = messages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }))
  const model = encodeURIComponent(modelFor(env, 'gemini'))
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', signal: AbortSignal.timeout(8_000),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': String(env.GEMINI_API_KEY) },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, tools: [{ function_declarations: declarations }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } } }),
  })
  const data = await jsonResponse(response)
  const candidates = Array.isArray(data?.candidates) ? data.candidates as { content?: { parts?: { functionCall?: { name?: string; args?: unknown }[] }[] } }[] : []
  const parts = candidates[0]?.content?.parts ?? []
  const call = parts.flatMap((part) => part.functionCall ?? []).find((item) => item.name)
  return call?.name && call.args && typeof call.args === 'object' ? { name: call.name, input: call.args as Record<string, unknown> } : undefined
}

export async function routeLanguageModel(env: Env, system: string, messages: LanguageMessage[], tools: LanguageTool[]): Promise<RoutedLanguageTool | undefined> {
  for (const provider of configuredProviders(env)) {
    try {
      const result = provider === 'anthropic'
        ? await callAnthropic(env, system, messages, tools)
        : provider === 'openai' ? await callOpenAi(env, system, messages, tools) : await callGemini(env, system, messages, tools)
      if (result) return result
    } catch { /* Le fallback déterministe prend le relais. */ }
  }
  return undefined
}
