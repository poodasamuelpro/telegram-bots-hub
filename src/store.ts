import type { Env, TelegramUpdate } from './types'

function database(env: Env): D1Database {
  if (!env.DB) throw new Error('Le binding D1 DB n’est pas configuré pour ce Worker.')
  return env.DB
}

export async function ensureBot(env: Env, botId: string, name: string, logic: string): Promise<void> {
  await database(env).prepare('INSERT OR IGNORE INTO bot_instances(id,name,description,logic) VALUES(?,?,?,?)').bind(botId, name, `Bot ${name}`, logic).run()
}
export async function recordEvent(env: Env, botId: string, update: TelegramUpdate, eventType: string, chatId?: string, userId?: number): Promise<void> {
  await database(env).prepare('INSERT INTO bot_events(bot_id,update_id,telegram_user_id,chat_id,event_type,payload_json) VALUES(?,?,?,?,?,?)').bind(botId, update.update_id, userId == null ? null : String(userId), chatId ?? null, eventType, JSON.stringify(update)).run()
  await database(env).prepare("INSERT INTO bot_metrics(bot_id,metric_date,messages_received) VALUES(?,date('now'),1) ON CONFLICT(bot_id,metric_date) DO UPDATE SET messages_received=messages_received+1").bind(botId).run()
}
export async function recordSent(env: Env, botId: string): Promise<void> { await database(env).prepare("INSERT INTO bot_metrics(bot_id,metric_date,messages_sent) VALUES(?,date('now'),1) ON CONFLICT(bot_id,metric_date) DO UPDATE SET messages_sent=messages_sent+1").bind(botId).run() }
export async function recordError(env: Env, botId: string): Promise<void> { await database(env).prepare("INSERT INTO bot_metrics(bot_id,metric_date,errors) VALUES(?,date('now'),1) ON CONFLICT(bot_id,metric_date) DO UPDATE SET errors=errors+1").bind(botId).run() }
export async function getState(env: Env, botId: string, chatId: string): Promise<Record<string, unknown>> { const row = await database(env).prepare('SELECT state_json FROM conversations WHERE bot_id=? AND chat_id=?').bind(botId, chatId).first<{state_json: string}>(); try { return row ? JSON.parse(row.state_json) as Record<string, unknown> : {} } catch { return {} } }
export async function saveState(env: Env, botId: string, chatId: string, state: Record<string, unknown>): Promise<void> { await database(env).prepare("INSERT INTO conversations(bot_id,chat_id,state_json,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(bot_id,chat_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at").bind(botId, chatId, JSON.stringify(state)).run() }
