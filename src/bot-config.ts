import type { Env, BotDefinition } from './types'
import { BOT_REGISTRY } from './bots'

export type ConfiguredBot = { id: string; name: string; logic: 'registration' | 'ai_chat' | 'test'; enabled: boolean }
export function configuredBots(env: Env): ConfiguredBot[] {
  const builtins = Object.values(BOT_REGISTRY).map((bot) => ({ id: bot.id, name: bot.name, logic: bot.logic, enabled: true }))
  try {
    const extra = JSON.parse(String(env.BOT_REGISTRY_JSON || '[]')) as ConfiguredBot[]
    if (!Array.isArray(extra)) return builtins
    return [...builtins, ...extra.filter((bot) => bot && typeof bot.id === 'string' && !builtins.some((b) => b.id === bot.id))]
  } catch { return builtins }
}
export function resolveBot(env: Env, botId: string): BotDefinition | undefined {
  const builtin = BOT_REGISTRY[botId]
  if (builtin) return builtin
  const configured = configuredBots(env).find((bot) => bot.id === botId && bot.enabled)
  if (!configured) return undefined
  const fallback = BOT_REGISTRY[configured.logic === 'ai_chat' ? 'ai-chat' : configured.logic === 'test' ? 'test-bot' : 'registration']
  return fallback ? { ...fallback, id: botId, name: configured.name } : undefined
}
