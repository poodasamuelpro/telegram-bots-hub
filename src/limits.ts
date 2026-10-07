import type { Env } from './types'

export async function allowTelegramMessage(env: Env, botId: string, chatId: string, limit = 30, windowSeconds = 60): Promise<boolean> {
  const key = `rl:${botId}:${chatId}`
  const current = Number(await env.BOT_KV.get(key) || '0')
  if (current >= limit) return false
  await env.BOT_KV.put(key, String(current + 1), { expirationTtl: windowSeconds })
  return true
}
