import type { Env, InlineKeyboard } from '../types'
import type { BotManifest } from '../types'
import { HubError } from '../types'

function token(env: Env, bot: BotManifest): string {
  const value = String(env[bot.tokenEnv] ?? '')
  if (!value) throw new HubError('telegram_token_missing')
  return value
}
async function api(env: Env, bot: BotManifest, method: string, body: BodyInit, json = true): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${token(env, bot)}/${method}`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      ...(json ? { headers: { 'Content-Type': 'application/json' } } : {}), body,
    })
  } catch { throw new HubError('telegram_unreachable') }
  const data = await response.json().catch(() => null) as { ok?: boolean } | null
  if (!response.ok || !data?.ok) throw new HubError('telegram_api_error')
  return data
}

function splitText(text: string, max = 3800): string[] {
  if (text.length <= max) return [text]
  const result: string[] = []
  let remaining = text
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf('\n', max)
    if (cut < max * 0.4) cut = max
    result.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut).replace(/^\n/, '')
  }
  if (remaining) result.push(remaining)
  return result
}
export async function sendMessage(env: Env, bot: BotManifest, chatId: string, text: string, keyboard?: InlineKeyboard): Promise<void> {
  const parts = splitText(text)
  for (let index = 0; index < parts.length; index++) {
    const body = { chat_id: chatId, text: parts[index], parse_mode: 'HTML', ...(index === 0 && keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}) }
    await api(env, bot, 'sendMessage', JSON.stringify(body))
  }
}
export async function sendDocument(env: Env, bot: BotManifest, chatId: string, fileName: string, bytes: Uint8Array): Promise<void> {
  const form = new FormData()
  form.set('chat_id', chatId)
  const buffer = new ArrayBuffer(bytes.length)
  new Uint8Array(buffer).set(bytes)
  form.set('document', new File([buffer], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  await api(env, bot, 'sendDocument', form, false)
}
export async function answerCallback(env: Env, bot: BotManifest, callbackId: string, text?: string): Promise<void> {
  const body = { callback_query_id: callbackId, ...(text ? { text: text.slice(0, 180) } : {}) }
  await api(env, bot, 'answerCallbackQuery', JSON.stringify(body))
}
