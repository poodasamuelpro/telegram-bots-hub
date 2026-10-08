import type { Env } from './types'

const createMemoryKV = (): KVNamespace => {
  const memory = new Map<string, { value: string; expiresAt?: number }>()
  const getValue = async (key: string): Promise<string | null> => {
    const item = memory.get(key)
    if (!item) return null
    if (item.expiresAt && item.expiresAt <= Date.now()) { memory.delete(key); return null }
    return item.value
  }

  return {
    async get(key: string) { return getValue(key) },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      memory.set(key, { value, expiresAt: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined })
    },
    async delete(key: string) { memory.delete(key) },
    async list(options?: { prefix?: string; limit?: number }) {
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? 1000
      const keys = []
      for (const key of memory.keys()) {
        if (key.startsWith(prefix) && await getValue(key) !== null) keys.push({ name: key })
        if (keys.length >= limit) break
      }
      return { keys, list_complete: true, cacheStatus: null }
    },
    async getWithMetadata(key: string) {
      return { value: await getValue(key), metadata: null }
    }
  } as unknown as KVNamespace
}

const fallbackHubKV = createMemoryKV()
const fallbackBotKV = createMemoryKV()
const warned = new Set<string>()

function warnOnce(binding: string): void {
  if (warned.has(binding)) return
  warned.add(binding)
  console.warn(`[telegram-bots-hub] ${binding} absent : stockage mémoire temporaire, éphémère et local à cette instance Worker. Configurez le vrai binding Cloudflare pour la persistance et le partage entre instances.`)
}

export function hubKV(env: Pick<Env, 'HUB_KV'>): KVNamespace {
  if (env.HUB_KV) return env.HUB_KV
  warnOnce('HUB_KV')
  return fallbackHubKV
}

export function botKV(env: Pick<Env, 'BOT_KV'>): KVNamespace {
  if (env.BOT_KV) return env.BOT_KV
  warnOnce('BOT_KV')
  return fallbackBotKV
}
