import { describe, expect, it } from 'vitest'
import { botKV, hubKV } from '../src/runtime-kv'
import type { Env } from '../src/types'

describe('fallback KV temporaire', () => {
  it('permet get/put/delete lorsque HUB_KV est absent', async () => {
    const env = {} as Env
    const key = `test:${crypto.randomUUID()}`
    await hubKV(env).put(key, 'valeur', { expirationTtl: 30 })
    expect(await hubKV(env).get(key)).toBe('valeur')
    await hubKV(env).delete(key)
    expect(await hubKV(env).get(key)).toBeNull()
  })

  it('sépare le stockage BOT_KV du stockage HUB_KV absent', async () => {
    const env = {} as Env
    const key = `test:${crypto.randomUUID()}`
    await hubKV(env).put(key, 'hub')
    await botKV(env).put(key, 'bot')
    expect(await hubKV(env).get(key)).toBe('hub')
    expect(await botKV(env).get(key)).toBe('bot')
  })
})
