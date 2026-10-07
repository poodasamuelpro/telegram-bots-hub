import { Hono } from 'hono'
import type { Env } from './types'
import { BOT_REGISTRY, botForWebhookPath } from './registry'
import { TelegramUpdateSchema, constantTimeEqual, isAuthorizedPrivateUpdate } from './core/security'
import { allowAdminMessage, claimUpdate, readConversation } from './core/state'
import { answerCallback } from './core/telegram'
import { HubError } from './types'

const app = new Hono<{ Bindings: Env }>()
const generic = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

app.post('/tg/:path', async (c) => {
  const path = c.req.param('path')
  const bot = botForWebhookPath(path, c.env)
  if (!bot) return generic()
  const expected = String(c.env[bot.webhookSecretEnv] ?? '')
  const supplied = c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? ''
  if (!expected || !constantTimeEqual(expected, supplied)) return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } })
  let parsed: unknown
  try { parsed = await c.req.json() } catch { return c.body(null, 200) }
  const update = TelegramUpdateSchema.safeParse(parsed)
  if (!update.success) return c.body(null, 200)
  const telegramUpdate = update.data
  if (!isAuthorizedPrivateUpdate(telegramUpdate, c.env, bot)) return c.body(null, 200)
  const user = telegramUpdate.message?.from ?? telegramUpdate.callback_query?.from
  const chat = telegramUpdate.message?.chat ?? telegramUpdate.callback_query?.message?.chat
  if (!user || !chat) return c.body(null, 200)
  try {
    if (!(await claimUpdate(c.env, bot.id, telegramUpdate.update_id))) return c.body(null, 200)
    if (!(await allowAdminMessage(c.env, bot.id, user.id, telegramUpdate.update_id))) {
      c.executionCtx.waitUntil(answerCallback(c.env, bot, telegramUpdate.callback_query?.id ?? '', 'Limite de 30 messages par minute atteinte.').catch(() => undefined))
      return c.body(null, 200)
    }
    const text = telegramUpdate.message?.text?.trim() ?? telegramUpdate.callback_query?.data ?? ''
    const history = await readConversation(c.env, bot.id, user.id).catch(() => [])
    c.executionCtx.waitUntil(bot.handle({ env: c.env, botId: bot.id, update: telegramUpdate, chatId: String(chat.id), user, text, history, state: { history } }).catch((error: unknown) => {
      const code = error instanceof HubError ? error.code : 'internal_error'
      console.error(JSON.stringify({ bot: bot.id, intent: text.startsWith('/') ? text.slice(0, 32) : 'language_message', code }))
      if (telegramUpdate.callback_query) return answerCallback(c.env, bot, telegramUpdate.callback_query.id, 'Traitement indisponible.').catch(() => undefined)
    }))
  } catch (error) {
    const code = error instanceof HubError ? error.code : 'state_error'
    console.error(JSON.stringify({ bot: bot.id, intent: 'webhook', code }))
  }
  return c.body(null, 200)
})

app.notFound(() => generic())
app.onError(() => new Response('Service indisponible', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }))
export { BOT_REGISTRY }
export default app
