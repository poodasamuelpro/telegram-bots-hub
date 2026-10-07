import type { BotContext, BotDefinition, BotResponse } from '../types'

function registration(ctx: BotContext): Promise<BotResponse> {
  const name = ctx.user?.first_name || 'ami'
  if (/^(\/start|start)$/i.test(ctx.text)) return Promise.resolve({ text: `Bonjour ${name} ! Je collecte les inscriptions bêta. Écris /inscrire pour commencer ou /aide pour voir les commandes.` })
  if (/^\/aide$/i.test(ctx.text)) return Promise.resolve({ text: '/inscrire — démarrer une inscription\n/statut — voir le statut\n/annuler — annuler' })
  if (/^\/inscrire$/i.test(ctx.text)) return Promise.resolve({ text: 'Parfait. Envoie ton nom complet, ton email, ton numéro WhatsApp et ta ville dans un seul message.' })
  if (/^\/statut$/i.test(ctx.text)) return Promise.resolve({ text: 'Les inscriptions sont ouvertes. Un administrateur validera les informations reçues.' })
  return Promise.resolve({ text: 'Je suis le bot d’inscription. Utilise /inscrire ou /aide.' })
}
async function aiChat(ctx: BotContext): Promise<BotResponse> {
  if (/^\/start$/i.test(ctx.text)) return { text: 'Bonjour. Je suis l’assistant IA du hub. Pose-moi une question.' }
  if (!ctx.env.ANTHROPIC_API_KEY) return { text: 'Assistant IA non configuré pour le moment.' }
  const model = ctx.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'
  const maxTokens = Math.min(Number(ctx.env.DEFAULT_AI_MAX_TOKENS || 700), 2000)
  const previous = Array.isArray(ctx.state.history) ? ctx.state.history.filter((item): item is { role: 'user' | 'assistant'; content: string } => Boolean(item && typeof item === 'object' && ((item as { role?: string }).role === 'user' || (item as { role?: string }).role === 'assistant') && typeof (item as { content?: unknown }).content === 'string')).slice(-8) : []
  const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': ctx.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: maxTokens, system: 'Tu es un assistant Telegram concis, utile et prudent. Réponds en français sauf demande contraire.', messages: [...previous, { role: 'user', content: ctx.text }] }) })
  if (!response.ok) throw new Error(`Anthropic API ${response.status}`)
  const data = await response.json() as { content?: { type: string; text?: string }[] }
  const answer = data.content?.find((part) => part.type === 'text')?.text || 'Je n’ai pas pu générer une réponse.'
  return { text: answer }
}
function testBot(ctx: BotContext): Promise<BotResponse> {
  if (/^\/start$/i.test(ctx.text)) return Promise.resolve({ text: 'Bot de test opérationnel.', buttons: [[{ text: 'Tester le bouton', callback_data: 'test:button' }, { text: 'État du webhook', callback_data: 'test:status' }]] })
  if (ctx.update.callback_query?.data === 'test:button') return Promise.resolve({ text: 'Callback Telegram reçu et traité avec succès.' })
  if (ctx.update.callback_query?.data === 'test:status') return Promise.resolve({ text: 'Le routage, la signature du webhook et la base D1 sont actifs.' })
  return Promise.resolve({ text: `Message reçu : ${ctx.text || '(vide)'}` })
}
export const BOT_REGISTRY: Record<string, BotDefinition> = {
  registration: { id: 'registration', name: 'Bot inscriptions', logic: 'registration', handle: registration },
  'ai-chat': { id: 'ai-chat', name: 'Assistant IA', logic: 'ai_chat', handle: aiChat },
  'test-bot': { id: 'test-bot', name: 'Bot de test', logic: 'test', handle: testBot }
}
export function getBot(botId: string): BotDefinition | undefined { return BOT_REGISTRY[botId] }
