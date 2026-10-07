import { BOT_REGISTRY } from '../src/registry'

const base = String(process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '')
if (!base) throw new Error('PUBLIC_BASE_URL is required')
const baseUrl = new URL(base)
if (baseUrl.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use HTTPS')

let registered = 0
for (const bot of Object.values(BOT_REGISTRY)) {
  const token = String(process.env[bot.tokenEnv] ?? '').trim()
  const webhookSecret = String(process.env[bot.webhookSecretEnv] ?? '').trim()
  const webhookPath = String(process.env[bot.webhookPathEnv] ?? '').trim()
  if (!token && !webhookSecret && !webhookPath) continue
  if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret) || !/^[A-Za-z0-9_-]{32,160}$/.test(webhookPath)) {
    throw new Error(`Missing or invalid webhook configuration for bot ${bot.id}`)
  }
  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${baseUrl.origin}/tg/${webhookPath}`, secret_token: webhookSecret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }),
    })
  } catch { throw new Error(`Telegram webhook request failed for bot ${bot.id}`) }
  const result = await response.json().catch(() => null) as { ok?: boolean } | null
  if (!response.ok || !result?.ok) throw new Error(`Telegram rejected webhook configuration for bot ${bot.id} (HTTP ${response.status})`)
  registered++
  console.log(`Webhook registered: ${bot.id}`)
}
if (!registered) throw new Error('No bot webhook credentials found in the environment')
