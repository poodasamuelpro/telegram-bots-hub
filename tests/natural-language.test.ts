import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasLanguageModelProvider, routeLanguageModel } from '../src/core/natural-language'
import type { Env } from '../src/types'

const tool = [{ name: 'stats', description: 'Lire les statistiques.', input_schema: { type: 'object', properties: {}, additionalProperties: false } }]
const messages = [{ role: 'user' as const, content: 'Combien de testeurs avons-nous ?' }]
const env = (extra: Record<string, unknown>) => ({ NL_PROVIDER: 'auto', ...extra }) as unknown as Env

afterEach(() => vi.unstubAllGlobals())

describe('matrice des fournisseurs IA', () => {
  it('détecte Anthropic, OpenAI ou Gemini sans imposer un fournisseur', () => {
    expect(hasLanguageModelProvider(env({ ANTHROPIC_API_KEY: 'a' }))).toBe(true)
    expect(hasLanguageModelProvider(env({ OPENAI_API_KEY: 'o' }))).toBe(true)
    expect(hasLanguageModelProvider(env({ GEMINI_API_KEY: 'g' }))).toBe(true)
    expect(hasLanguageModelProvider(env({}))).toBe(false)
  })

  it.each([
    ['anthropic', { ANTHROPIC_API_KEY: 'a' }, { content: [{ type: 'tool_use', name: 'stats', input: {} }] }],
    ['openai', { OPENAI_API_KEY: 'o' }, { choices: [{ message: { tool_calls: [{ function: { name: 'stats', arguments: '{}' } }] } }] }],
    ['gemini', { GEMINI_API_KEY: 'g' }, { candidates: [{ content: { parts: [{ functionCall: { name: 'stats', args: {} } }] } }] }],
  ])('extrait un outil depuis %s', async (provider, keys, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
    const result = await routeLanguageModel(env({ NL_PROVIDER: provider, ...keys }), 'Route uniquement.', messages, tool)
    expect(result).toEqual({ name: 'stats', input: {} })
  })
})
