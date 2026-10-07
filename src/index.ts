import { Hono } from 'hono'
import type { Env, TelegramUpdate } from './types'
import { getBot } from './bots'
import { answerCallback, getWebhookInfo, isTelegramUpdate, sendMessage, setWebhook, verifyWebhook } from './telegram'
import { getState, recordError, recordEvent, recordSent, saveState } from './store'

const app = new Hono<{ Bindings: Env }>()

function adminAuthorized(c: { req: { header(name: string): string | undefined }; env: Env }): boolean {
  const token = c.env.ADMIN_TOKEN
  return Boolean(token && c.req.header('Authorization') === `Bearer ${token}`)
}
function jsonError(message: string, status = 400): Response { return Response.json({ ok: false, error: message }, { status, headers: { 'Cache-Control': 'no-store' } }) }

app.get('/', (c) => c.json({ name: 'telegram-bots-hub', status: 'ok', bots: ['registration', 'ai-chat', 'test-bot'] }))
app.get('/health', (c) => c.json({ ok: true, service: 'telegram-bots-hub', timestamp: new Date().toISOString() }))

app.post('/webhook/:botId', async (c) => {
  const botId = c.req.param('botId')
  const bot = getBot(botId)
  if (!bot) return jsonError('Bot inconnu.', 404)
  if (!verifyWebhook(c.req.raw, c.env, botId)) return jsonError('Webhook non authentifié.', 401)
  let update: unknown
  try { update = await c.req.json() } catch { return jsonError('JSON invalide.') }
  if (!isTelegramUpdate(update)) return jsonError('Mise à jour Telegram invalide.')
  const telegramUpdate = update as TelegramUpdate
  const message = telegramUpdate.message || telegramUpdate.callback_query?.message
  const chatId = message?.chat.id != null ? String(message.chat.id) : ''
  const user = telegramUpdate.message?.from || telegramUpdate.callback_query?.from
  const text = telegramUpdate.message?.text?.trim() || telegramUpdate.callback_query?.data?.trim() || ''
  c.executionCtx.waitUntil(recordEvent(c.env, botId, telegramUpdate, telegramUpdate.callback_query ? 'callback_query' : 'message', chatId, user?.id).catch(() => recordError(c.env, botId)))
  if (!chatId) return c.json({ ok: true, ignored: true })
  try {
    const state = await getState(c.env, botId, chatId)
    const response = await bot.handle({ env: c.env, botId, update: telegramUpdate, chatId, user, text, state })
    if (response.text) {
      await sendMessage(c.env, botId, chatId, response.text, response.buttons)
      c.executionCtx.waitUntil(recordSent(c.env, botId))
    }
    if (telegramUpdate.callback_query) c.executionCtx.waitUntil(answerCallback(c.env, botId, telegramUpdate.callback_query.id).catch(() => undefined))
    await saveState(c.env, botId, chatId, { ...state, lastText: text, lastUpdateId: telegramUpdate.update_id })
    return c.json({ ok: true })
  } catch (error) {
    c.executionCtx.waitUntil(recordError(c.env, botId))
    console.error(`[${botId}] webhook error`, error instanceof Error ? error.message : error)
    return c.json({ ok: false, error: 'Traitement temporairement indisponible.' }, 500)
  }
})

app.get('/admin', (c) => {
  if (!adminAuthorized(c)) return jsonError('Non autorisé.', 401)
  const cards = Object.values({ registration: 1, 'ai-chat': 1, 'test-bot': 1 }).map((_, i) => i)
  return c.html(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Telegram Bots Hub</title><style>body{font:16px system-ui;max-width:960px;margin:40px auto;padding:0 20px;color:#172033}h1{color:#0f766e}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.card{border:1px solid #d7dee8;border-radius:12px;padding:18px;background:#fff}.ok{color:#047857}code{background:#eef2f7;padding:2px 5px;border-radius:4px}</style></head><body><h1>Telegram Bots Hub</h1><p>Registre extensible, webhooks sécurisés et métriques D1.</p><div class="grid">${cards.map((i) => `<div class="card"><strong>${['registration','ai-chat','test-bot'][i]}</strong><p class="ok">Logique active</p><code>/webhook/${['registration','ai-chat','test-bot'][i]}</code></div>`).join('')}</div><p>Utilise <code>POST /admin/webhooks/register</code> avec le Bearer admin pour enregistrer les webhooks.</p></body></html>`)
})
app.get('/admin/webhooks/:botId', async (c) => { if (!adminAuthorized(c)) return jsonError('Non autorisé.', 401); try { return c.json({ ok: true, botId: c.req.param('botId'), info: await getWebhookInfo(c.env, c.req.param('botId')) }) } catch (e) { return jsonError(e instanceof Error ? e.message : 'Erreur Telegram.', 502) } })
app.post('/admin/webhooks/register', async (c) => {
  if (!adminAuthorized(c)) return jsonError('Non autorisé.', 401)
  const baseUrl = c.env.PUBLIC_BASE_URL
  if (!baseUrl || baseUrl.includes('<account>')) return jsonError('PUBLIC_BASE_URL doit être configurée.', 500)
  const results: Record<string, string> = {}
  for (const id of ['registration', 'ai-chat', 'test-bot']) {
    try { await setWebhook(c.env, id, baseUrl); results[id] = 'registered' } catch (e) { results[id] = e instanceof Error ? e.message : 'failed' }
  }
  return c.json({ ok: Object.values(results).every((v) => v === 'registered'), results })
})
app.get('/admin/bots', (c) => { if (!adminAuthorized(c)) return jsonError('Non autorisé.', 401); return c.json({ ok: true, bots: ['registration', 'ai-chat', 'test-bot'] }) })

export default app
