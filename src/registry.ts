import type { BotManifest } from './types'

function defineBot(id: string, name: string, handle: BotManifest['handle']): BotManifest {
  const prefix = `BOT_${id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`
  return { id, name, tokenEnv: `${prefix}_TOKEN`, webhookSecretEnv: `${prefix}_WEBHOOK_SECRET`, webhookPathEnv: `${prefix}_WEBHOOK_PATH`, adminIdsEnv: `${prefix}_ADMIN_IDS`, handle }
}

export const BOT_REGISTRY: Record<string, BotManifest> = {
  testeurprojets: defineBot('testeurprojets', 'Testeurprojets', async (ctx) => (await import('./bots/testeurprojets')).handleTesteurProjets(ctx)),
}

export function botForWebhookPath(path: string, env: Record<string, unknown>): BotManifest | undefined {
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(path)) return undefined
  return Object.values(BOT_REGISTRY).find((bot) => String(env[bot.webhookPathEnv] ?? '') === path)
}
