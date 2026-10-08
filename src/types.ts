export interface Env {
  DB?: D1Database
  BOT_KV?: KVNamespace
  HUB_KV?: KVNamespace
  PUBLIC_BASE_URL?: string
  HUB_ADMIN_IDS?: string
  HUB_CALLBACK_SECRET?: string
  HUB_TIMEZONE?: string
  NL_PROVIDER?: string
  NL_MODEL?: string
  NL_DAILY_LIMIT?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  DEFAULT_AI_MAX_TOKENS?: string
  BOT_REGISTRY_JSON?: string
  BOT_TESTEURPROJETS_TOKEN?: string
  BOT_TESTEURPROJETS_WEBHOOK_SECRET?: string
  BOT_TESTEURPROJETS_WEBHOOK_PATH?: string
  BOT_TESTEURPROJETS_ADMIN_IDS?: string
  [key: string]: unknown
}

export type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string }
export type TelegramChat = { id: number | string; type: 'private' | 'group' | 'supergroup' | 'channel' }
export type TelegramMessage = { message_id: number; from?: TelegramUser; chat: TelegramChat; text?: string }
export type TelegramCallbackQuery = { id: string; from: TelegramUser; message?: TelegramMessage; data?: string }
export type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }
export type InlineButton = { text: string; callback_data?: string; url?: string }
export type InlineKeyboard = InlineButton[][]
export type ConversationTurn = { user: string; intent: string; at: number }
export type BotContext = {
  env: Env
  botId: string
  update: TelegramUpdate
  user: TelegramUser
  text: string
  state: Record<string, unknown>
  chatId: string
  history: ConversationTurn[]
}
export type BotResponse = { text: string; buttons?: InlineKeyboard }
export type BotDefinition = {
  id: string
  name: string
  logic: 'registration' | 'ai_chat' | 'test'
  handle(ctx: BotContext): Promise<BotResponse>
}
export type BotManifest = {
  id: string
  name: string
  tokenEnv: string
  webhookSecretEnv: string
  webhookPathEnv: string
  adminIdsEnv?: string
  handle(ctx: BotContext): Promise<void>
}

export class HubError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'HubError' }
}
