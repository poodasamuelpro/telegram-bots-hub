import type { Env } from './types'
import { botKV } from './runtime-kv'

export async function allowTelegramMessage(env: Env, botId: string, chatId: string, limit = 30, windowSeconds = 60): Promise<boolean> {
  const key = `rl:${botId}:${chatId}`
  const current = Number(await botKV(env).get(key) || '0')
  if (current >= limit) return false
  await botKV(env).put(key, String(current + 1), { expirationTtl: windowSeconds })
  return true
}
