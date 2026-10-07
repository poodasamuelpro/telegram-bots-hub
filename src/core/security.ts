import { z } from 'zod'
import type { BotManifest, Env, TelegramUpdate } from '../types'

export const REQUIRED_ADMIN_ID = '6730264801'

const UserSchema = z.object({ id: z.number().int(), first_name: z.string().optional(), last_name: z.string().optional(), username: z.string().optional() }).passthrough()
const ChatSchema = z.object({ id: z.union([z.number(), z.string()]), type: z.enum(['private', 'group', 'supergroup', 'channel']) }).passthrough()
const MessageSchema = z.object({ message_id: z.number(), from: UserSchema.optional(), chat: ChatSchema, text: z.string().optional() }).passthrough()
export const TelegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: MessageSchema.optional(),
  callback_query: z.object({ id: z.string(), from: UserSchema, message: MessageSchema.optional(), data: z.string().optional() }).passthrough().optional(),
}).passthrough()

export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let diff = left.length ^ right.length
  const n = Math.max(left.length, right.length)
  for (let i = 0; i < n; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return diff === 0
}

export function isAuthorizedPrivateUpdate(update: TelegramUpdate, env: Env, bot: BotManifest): boolean {
  const message = update.message ?? update.callback_query?.message
  const user = update.message?.from ?? update.callback_query?.from
  if (!message || message.chat.type !== 'private' || !user) return false
  const globalIds = String(env.HUB_ADMIN_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  const botIds = bot.adminIdsEnv ? String(env[bot.adminIdsEnv] ?? '').split(',').map((value) => value.trim()).filter(Boolean) : []
  const allowed = new Set([REQUIRED_ADMIN_ID, ...globalIds, ...botIds])
  return allowed.has(String(user.id))
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function safeIntent(text: string): string {
  const command = text.match(/^\/(\w+)/)?.[1]
  if (command) return command.toLowerCase().slice(0, 32)
  return 'language_message'
}
