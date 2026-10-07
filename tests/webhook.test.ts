import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { BOT_REGISTRY } from '../src/registry'
import { isAuthorizedPrivateUpdate, TelegramUpdateSchema } from '../src/core/security'
import type { Env } from '../src/types'

const path = 'A'.repeat(32)
const webhookSecret = 'B'.repeat(32)
const env = { BOT_TESTEURPROJETS_WEBHOOK_PATH: path, BOT_TESTEURPROJETS_WEBHOOK_SECRET: webhookSecret, HUB_ADMIN_IDS: '42' } as unknown as Env
const execution = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

async function post(pathname: string, secret: string, body = '{}'): Promise<Response> {
  return app.fetch(new Request(`https://hub.example${pathname}`, { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body }), env, execution)
}

describe('route webhook Worker', () => {
  it('retourne 404 pour toute route autre que le webhook et pour un chemin invalide', async () => {
    expect((await post('/health', webhookSecret)).status).toBe(404)
    expect((await post('/tg/short', webhookSecret)).status).toBe(404)
  })
  it('refuse une absence ou une mauvaise valeur du secret Telegram', async () => {
    expect((await post(`/tg/${path}`, 'wrong-secret')).status).toBe(401)
  })
  it('accuse une update mal formée sans exposer le contenu', async () => {
    const response = await post(`/tg/${path}`, webhookSecret, '{')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })
  it('coupe un corps supérieur à 64 Kio après authentification', async () => {
    expect((await post(`/tg/${path}`, webhookSecret, 'x'.repeat(65_537))).status).toBe(413)
  })
})

describe('whitelist privée', () => {
  const update = (userId: number, chatType: 'private' | 'group') => TelegramUpdateSchema.parse({ update_id: 1, message: { message_id: 1, from: { id: userId, first_name: 'Admin' }, chat: { id: userId, type: chatType }, text: '/stats' } })
  it('n’autorise que l’identifiant admin en conversation privée', () => {
    expect(isAuthorizedPrivateUpdate(update(42, 'private'), env, BOT_REGISTRY.testeurprojets!)).toBe(true)
    expect(isAuthorizedPrivateUpdate(update(7, 'private'), env, BOT_REGISTRY.testeurprojets!)).toBe(false)
    expect(isAuthorizedPrivateUpdate(update(42, 'group'), env, BOT_REGISTRY.testeurprojets!)).toBe(false)
  })
  it('utilise la whitelist propre au bot lorsqu’elle est définie', () => {
    const specific = { ...env, BOT_TESTEURPROJETS_ADMIN_IDS: '7' } as Env
    expect(isAuthorizedPrivateUpdate(update(7, 'private'), specific, BOT_REGISTRY.testeurprojets!)).toBe(true)
    expect(isAuthorizedPrivateUpdate(update(42, 'private'), specific, BOT_REGISTRY.testeurprojets!)).toBe(false)
  })
})
