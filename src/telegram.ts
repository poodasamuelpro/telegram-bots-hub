import type { Env, TelegramUpdate } from './types'

export function botToken(env: Env, botId: string): string {
  const key = `TELEGRAM_BOT_TOKEN_${botId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
  return String(env[key] ?? '')
}
export function webhookSecret(env: Env, botId: string): string {
  const key = `TELEGRAM_WEBHOOK_SECRET_${botId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
  return String(env[key] ?? '')
}
function apiUrl(token: string, method: string): string { return `https://api.telegram.org/bot${token}/${method}` }
async function call<T>(env: Env, botId: string, method: string, body: Record<string, unknown>): Promise<T> {
  const token = botToken(env, botId)
  if (!token) throw new Error(`Missing Telegram token for ${botId}`)
  const response = await fetch(apiUrl(token, method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json() as { ok: boolean; result?: T; description?: string }
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`)
  return data.result as T
}
export function verifyWebhook(request: Request, env: Env, botId: string): boolean {
  const expected = webhookSecret(env, botId)
  return Boolean(expected) && request.headers.get('X-Telegram-Bot-Api-Secret-Token') === expected
}
export async function sendMessage(env: Env, botId: string, chatId: string, text: string, buttons?: { text: string; callback_data?: string; url?: string }[][]): Promise<void> {
  await call(env, botId, 'sendMessage', { chat_id: chatId, text: text.slice(0, 4096), ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}) })
}
export async function answerCallback(env: Env, botId: string, callbackQueryId: string): Promise<void> { await call(env, botId, 'answerCallbackQuery', { callback_query_id: callbackQueryId }) }
export async function setWebhook(env: Env, botId: string, baseUrl: string): Promise<void> {
  await call(env, botId, 'setWebhook', { url: `${baseUrl.replace(/\/$/, '')}/webhook/${botId}`, secret_token: webhookSecret(env, botId), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })
}
export async function getWebhookInfo(env: Env, botId: string): Promise<unknown> { return call(env, botId, 'getWebhookInfo', {}) }
export function isTelegramUpdate(value: unknown): value is TelegramUpdate { return Boolean(value && typeof value === 'object' && typeof (value as TelegramUpdate).update_id === 'number') }
