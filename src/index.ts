import { Hono } from 'hono'
import type { Env } from './types'
import { BOT_REGISTRY, botForWebhookPath } from './registry'
import { TelegramUpdateSchema, constantTimeEqual, isAuthorizedPrivateUpdate, safeIntent } from './core/security'
import { allowAdminMessage, claimUpdate, readConversation } from './core/state'
import { answerCallback, sendMessage } from './core/telegram'
import { HubError } from './types'

const app = new Hono<{ Bindings: Env }>()
const generic = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

async function boundedBody(request: Request, maxBytes = 65_536): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > maxBytes) return undefined
  if (!request.body) return ''
  const reader = request.body.getReader(); const decoder = new TextDecoder(); let size = 0; let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); return undefined }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally { reader.releaseLock() }
}

app.post('/tg/:path', async (c) => {
  const path = c.req.param('path')
  const bot = botForWebhookPath(path, c.env)
  if (!bot) return generic()
  const expected = String(c.env[bot.webhookSecretEnv] ?? '')
  const supplied = c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? ''
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(expected) || !constantTimeEqual(expected, supplied)) return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } })
  let parsed: unknown
  try { const body = await boundedBody(c.req.raw); if (body === undefined) return c.body('Payload too large', 413); parsed = JSON.parse(body) } catch { return c.body(null, 200) }
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
      const reply = telegramUpdate.callback_query
        ? answerCallback(c.env, bot, telegramUpdate.callback_query.id, 'Limite de 30 messages par minute atteinte.')
        : sendMessage(c.env, bot, String(chat.id), 'Limite de 30 messages par minute atteinte.')
      c.executionCtx.waitUntil(reply.catch(() => undefined))
      return c.body(null, 200)
    }
    const text = telegramUpdate.message?.text?.trim() ?? telegramUpdate.callback_query?.data ?? ''
    const history = await readConversation(c.env, bot.id, user.id).catch(() => [])
    c.executionCtx.waitUntil(bot.handle({ env: c.env, botId: bot.id, update: telegramUpdate, chatId: String(chat.id), user, text, history, state: { history } }).catch((error: unknown) => {
      const code = error instanceof HubError ? error.code : 'internal_error'
      console.error(JSON.stringify({ bot: bot.id, intent: safeIntent(text), code }))
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
