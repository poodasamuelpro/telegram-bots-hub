import type { BotManifest } from './types'
import { handleTesteurProjets } from './bots/testeurprojets'

export const BOT_REGISTRY: Record<string, BotManifest> = {
  testeurprojets: {
    id: 'testeurprojets',
    name: 'Testeurprojets',
    tokenEnv: 'BOT_TESTEURPROJETS_TOKEN',
    webhookSecretEnv: 'BOT_TESTEURPROJETS_WEBHOOK_SECRET',
    webhookPathEnv: 'BOT_TESTEURPROJETS_WEBHOOK_PATH',
    handle: handleTesteurProjets,
  },
}

export function botForWebhookPath(path: string, env: Record<string, unknown>): BotManifest | undefined {
  return Object.values(BOT_REGISTRY).find((bot) => String(env[bot.webhookPathEnv] ?? '') === path)
}
