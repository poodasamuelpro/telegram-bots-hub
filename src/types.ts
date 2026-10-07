export interface Env {
  DB: D1Database
  BOT_KV: KVNamespace
  PUBLIC_BASE_URL: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string
  DEFAULT_AI_MAX_TOKENS?: string
  ADMIN_TOKEN?: string
  BOT_REGISTRY_JSON?: string
  [key: string]: unknown
}

export type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string }
export type TelegramChat = { id: number; type: string; title?: string; username?: string }
export type TelegramMessage = { message_id: number; from?: TelegramUser; chat: TelegramChat; text?: string }
export type TelegramCallbackQuery = { id: string; from: TelegramUser; message?: TelegramMessage; data?: string }
export type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }

export type BotContext = {
  env: Env
  botId: string
  update: TelegramUpdate
  chatId: string
  user: TelegramUser | undefined
  text: string
  state: Record<string, unknown>
}

export type BotDefinition = {
  id: string
  name: string
  logic: 'registration' | 'ai_chat' | 'test'
  handle(ctx: BotContext): Promise<BotResponse>
}
export type BotResponse = { text?: string; buttons?: { text: string; callback_data?: string; url?: string }[][] }
