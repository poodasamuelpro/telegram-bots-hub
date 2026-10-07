import type { ConversationTurn, Env } from '../types'

const DAY = 86_400
const RATE_LIMIT = 30

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function claimUpdate(env: Env, botId: string, updateId: number): Promise<boolean> {
  const key = `dedup:${botId}:${updateId}`
  if (await env.HUB_KV.get(key)) return false
  await env.HUB_KV.put(key, '1', { expirationTtl: DAY })
  return true
}

export async function allowAdminMessage(env: Env, botId: string, userId: number, updateId: number): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000)
  const who = await digest(`${botId}:${userId}`)
  const prefix = `rate:${botId}:${who}:${minute}:`
  await env.HUB_KV.put(`${prefix}${updateId}`, '1', { expirationTtl: 120 })
  const result = await env.HUB_KV.list({ prefix, limit: RATE_LIMIT + 1 })
  return result.keys.length <= RATE_LIMIT
}

export async function allowAiCall(env: Env, botId: string, userId: number, updateId: number, limit: number): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10)
  const who = await digest(`${botId}:${userId}`)
  const prefix = `ai:${botId}:${who}:${day}:`
  await env.HUB_KV.put(`${prefix}${updateId}`, '1', { expirationTtl: DAY * 2 })
  const result = await env.HUB_KV.list({ prefix, limit: Math.max(1, limit + 1) })
  return result.keys.length <= limit
}

export async function readConversation(env: Env, botId: string, userId: number): Promise<ConversationTurn[]> {
  const who = await digest(`${botId}:${userId}`)
  const prefix = `ctx:${botId}:${who}:`
  const result = await env.HUB_KV.list({ prefix, limit: 8 })
  const turns: ConversationTurn[] = []
  for (const item of result.keys) {
    const raw = await env.HUB_KV.get(item.name)
    if (!raw) continue
    try {
      const value = JSON.parse(raw) as ConversationTurn
      if (typeof value.user === 'string' && typeof value.intent === 'string') turns.push(value)
    } catch { /* Ignore malformed ephemeral history. */ }
  }
  return turns.reverse()
}

export async function saveConversationTurn(env: Env, botId: string, userId: number, updateId: number, user: string, intent: string): Promise<void> {
  const who = await digest(`${botId}:${userId}`)
  const reverseTime = String(9_999_999_999_999 - Date.now()).padStart(13, '0')
  const key = `ctx:${botId}:${who}:${reverseTime}:${updateId}`
  const value: ConversationTurn = { user: user.slice(0, 240), intent: intent.slice(0, 40), at: Date.now() }
  await env.HUB_KV.put(key, JSON.stringify(value), { expirationTtl: DAY })
}

export async function markCallbackUsed(env: Env, nonce: string): Promise<boolean> {
  const key = `callback-used:${nonce}`
  if (await env.HUB_KV.get(key)) return false
  await env.HUB_KV.put(key, '1', { expirationTtl: 300 })
  return true
}
