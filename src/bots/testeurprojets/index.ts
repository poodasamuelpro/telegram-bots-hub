import { z } from 'zod'
import type { BotContext, InlineKeyboard } from '../../types'
import type { ProjectSlug } from '../../projects.config'
import { HubError } from '../../types'
import { PROJECTS, type ProjectConfig } from '../../projects.config'
import { allowAiCall, markCallbackUsed, saveConversationTurn } from '../../core/state'
import { answerCallback, sendDocument, sendMessage } from '../../core/telegram'
import { constantTimeEqual, escapeHtml, safeIntent } from '../../core/security'
import { createWorkbook } from '../../core/xlsx'
import { getOverview, listAllTesters, listTesters, projectHealth, projectBySlug, setOpen, updateTarget, type Tester, type TesterFilter } from '../../core/supabase'

const formatDate = (value: string, timezone: string) => {
  try { return new Intl.DateTimeFormat('fr-FR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) }
  catch { return value }
}
const safeHttps = (value: string) => { try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : '' } catch { return '' } }
const callbackSecret = (ctx: BotContext) => String(ctx.env.HUB_CALLBACK_SECRET ?? '')
const projectChoices = Object.values(PROJECTS)
const slugChar: Record<ProjectSlug, string> = { monmenu: 'm', sophiate: 's', vimsongre: 'v' }
const charSlug: Record<string, ProjectSlug> = { m: 'monmenu', s: 'sophiate', v: 'vimsongre' }

export function localMidnightUtc(date: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new HubError('invalid_date')
  const [, year, month, day] = match
  const target = Date.UTC(Number(year), Number(month) - 1, Number(day))
  const check = new Date(target)
  if (check.getUTCFullYear() !== Number(year) || check.getUTCMonth() + 1 !== Number(month) || check.getUTCDate() !== Number(day)) throw new HubError('invalid_date')
  let guess = target
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((part) => [part.type, part.value]))
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
    guess += target - observed
  }
  return new Date(guess).toISOString()
}

async function hmac(payload: string, secret: string): Promise<string> {
  if (!secret) throw new HubError('callback_secret_missing')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))).slice(0, 10)
  let binary = ''; for (const byte of signature) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
async function signed(ctx: BotContext, payload: string): Promise<string> {
  const value = `${payload}.${await hmac(payload, callbackSecret(ctx))}`
  if (new TextEncoder().encode(value).length > 64) throw new HubError('callback_data_too_long')
  return value
}
async function verifyCallback(ctx: BotContext, data: string): Promise<string[] | undefined> {
  const parts = data.split('.')
  if (parts.length !== 2) return undefined
  const expected = await hmac(parts[0] ?? '', callbackSecret(ctx))
  if (!constantTimeEqual(expected, parts[1] ?? '')) return undefined
  const values = (parts[0] ?? '').split('|')
  const expiry = Number(values.at(-2))
  if (!Number.isSafeInteger(expiry) || expiry < Math.floor(Date.now() / 1000)) return undefined
  return values
}
function shortNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8)); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function helpText(): string {
  return [
    '<b>Testeurprojets</b>',
    '/stats [projet] — inscrits, objectifs/quotas et état (alias /projets)',
    '/liste &lt;projet&gt; — liste récente, pages et filtres appareil=, ville=, depuis=',
    '/derniers [n] [projet] — 5 par défaut, 20 maximum',
    '/recherche &lt;texte&gt; [projet] — 10 résultats maximum',
    '/repartition &lt;projet&gt; — appareils, villes et champs propres au projet',
    '/export &lt;projet&gt; ou /exporttout — fichiers Excel',
    '/ouvrir &lt;projet&gt; · /fermer &lt;projet&gt; — confirmation obligatoire',
    '/quota &lt;projet&gt; &lt;n&gt; — confirmation obligatoire, entre inscrits et 500',
    '/sante — Supabase et site configuré', '/liens — WhatsApp et espace admin',
    'Exemple : « combien on a de monde sur MonMenu ? »',
  ].join('\n')
}
export function parseListArgs(raw: string, timezone = 'UTC'): { project?: ProjectConfig; filters: TesterFilter } {
  const [first = '', ...rest] = raw.trim().split(/\s+/)
  const project = projectBySlug(first.toLowerCase())
  const filters: TesterFilter = {}
  for (const part of (project ? rest : [first, ...rest])) {
    const [key, ...valueParts] = part.split('='); const value = valueParts.join('=').trim()
    if (!value) continue
    if (key?.toLowerCase() === 'appareil' || key?.toLowerCase() === 'device') filters.device = value
    if (key?.toLowerCase() === 'ville' || key?.toLowerCase() === 'city') filters.city = value
    if (key?.toLowerCase() === 'depuis' || key?.toLowerCase() === 'since') {
      filters.since = localMidnightUtc(value, timezone)
    }
  }
  return { project, filters }
}
function testerLine(tester: Tester, project: ProjectConfig, timezone: string): string {
  const extra = project.extraColumns.map((key) => {
    const label = key === 'use_case' ? 'À tester' : key === 'test_target' ? 'Cible' : key
    const value = tester.extra?.[key]
    return value == null || value === '' ? '' : ` · ${label}: ${escapeHtml(value)}`
  }).join('')
  return `• <b>${escapeHtml(tester.full_name)}</b> — ${escapeHtml(tester.email)} · ${escapeHtml(tester.whatsapp)}\n  ${escapeHtml(tester.country_city)} · ${escapeHtml(tester.device)}${extra} · ${formatDate(tester.created_at, timezone)}`
}
async function askProject(ctx: BotContext, action: string, state?: unknown): Promise<void> {
  const buttons: InlineKeyboard = []
  for (const project of projectChoices) {
    const nonce = shortNonce()
    if (state) await ctx.env.HUB_KV.put(`choice-state:${nonce}`, JSON.stringify(state), { expirationTtl: 300 })
    buttons.push([{ text: project.label, callback_data: await signed(ctx, `p|${action}|${slugChar[project.slug]}|${Math.floor(Date.now() / 1000) + 300}|${nonce}`) }])
  }
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, 'Choisis le projet :', buttons)
}
function bot(ctx: BotContext) {
  // The registry is static; secrets are selected by the manifest in the runtime router.
  return { id: ctx.botId, name: 'Testeurprojets', tokenEnv: 'BOT_TESTEURPROJETS_TOKEN', webhookSecretEnv: 'BOT_TESTEURPROJETS_WEBHOOK_SECRET', webhookPathEnv: 'BOT_TESTEURPROJETS_WEBHOOK_PATH', handle: async () => {} }
}
async function sendStats(ctx: BotContext, selected?: ProjectConfig): Promise<void> {
  const projects = selected ? [selected] : projectChoices
  const outcomes = await Promise.all(projects.map(async (project) => ({ project, result: await getOverview(ctx.env, project).then((value) => ({ value })).catch(() => ({ error: true })) })))
  let enrolled = 0; let remaining = 0; let ok = 0
  const lines = outcomes.map(({ project, result }) => {
    if ('error' in result) return `• <b>${project.label}</b> — indisponible`
    const item = result.value; ok++; enrolled += item.enrolled; remaining += item.remaining
    const targetLabel = item.goalOnly ? 'objectif' : 'max'
    const remainingLabel = item.goalOnly ? 'écart objectif' : 'places'
    return `• <b>${project.label}</b> : ${item.enrolled}/${targetLabel === 'max' ? item.target : `objectif ${item.target}`} · ${remainingLabel} ${item.remaining} · ${item.isOpen ? 'ouvert' : 'fermé'}`
  })
  lines.push(ok ? `\nTotal : ${enrolled} inscrits · ${remaining} ${ok === projects.length ? 'places/écarts cumulés' : 'places/écarts connus'}` : '\nAucun projet joignable.')
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, lines.join('\n'))
}
async function showList(ctx: BotContext, project: ProjectConfig, filters: TesterFilter, page: number): Promise<void> {
  const pageSize = 5
  const items = await listTesters(ctx.env, project, filters, pageSize + 1, page * pageSize)
  const hasNext = items.length > pageSize; const shown = items.slice(0, pageSize)
  const lines = shown.length ? shown.map((tester) => testerLine(tester, project, String(ctx.env.HUB_TIMEZONE || 'UTC'))).join('\n\n') : 'Aucun inscrit trouvé.'
  const keyboard: InlineKeyboard = []
  if (page > 0 || hasNext) {
    const stateId = shortNonce()
    await ctx.env.HUB_KV.put(`list-state:${stateId}`, JSON.stringify({ project: project.slug, filters }), { expirationTtl: 300 })
    const expiry = Math.floor(Date.now() / 1000) + 300
    const row = []
    if (page > 0) row.push({ text: '‹ Précédent', callback_data: await signed(ctx, `l|${stateId}|${page - 1}|${expiry}|${shortNonce()}`) })
    if (hasNext) row.push({ text: 'Suivant ›', callback_data: await signed(ctx, `l|${stateId}|${page + 1}|${expiry}|${shortNonce()}`) })
    keyboard.push(row)
  }
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, `<b>${project.label}</b> — page ${page + 1}\n\n${lines}`, keyboard)
}
async function sendRecent(ctx: BotContext, raw: string): Promise<void> {
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  const n = parts[0] && /^\d+$/.test(parts[0]) ? Math.min(20, Math.max(1, Number(parts.shift()))) : 5
  const slug = parts[0]?.toLowerCase()
  const selected = slug ? projectBySlug(slug) : undefined
  if (slug && !selected) throw new HubError('unknown_project')
  const projects = selected ? [selected] : projectChoices
  const results = await Promise.all(projects.map(async (project) => ({ project, testers: await listTesters(ctx.env, project, {}, n).catch(() => null) })))
  const lines = results.flatMap(({ project, testers }) => testers === null ? [`<b>${project.label}</b> — indisponible`] : [`<b>${project.label}</b>`, ...(testers.length ? testers.map((t) => testerLine(t, project, String(ctx.env.HUB_TIMEZONE || 'UTC'))) : ['Aucun inscrit.'])])
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, lines.join('\n'))
}
async function searchTesters(ctx: BotContext, raw: string): Promise<void> {
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  const maybeSlug = parts.at(-1)?.toLowerCase(); const project = maybeSlug ? projectBySlug(maybeSlug) : undefined
  if (project) parts.pop()
  const query = parts.join(' ').trim()
  if (!query) { await sendMessage(ctx.env, bot(ctx), ctx.chatId, 'Indique le nom, l’e-mail ou le WhatsApp à rechercher.'); return }
  const selected = project ? [project] : projectChoices
  const results = await Promise.all(selected.map(async (item) => ({ project: item, testers: await listTesters(ctx.env, item, { query }, 10).catch(() => null) })))
  const lines = results.flatMap(({ project: item, testers }) => testers === null ? [`<b>${item.label}</b> — indisponible`] : testers.map((tester) => `${escapeHtml(item.label)} · ${testerLine(tester, item, String(ctx.env.HUB_TIMEZONE || 'UTC'))}`))
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, lines.length ? lines.slice(0, 10).join('\n\n') : 'Aucun résultat.')
}
async function distribution(ctx: BotContext, project: ProjectConfig): Promise<void> {
  const testers = await listAllTesters(ctx.env, project)
  const counts = (values: string[]) => values.reduce<Record<string, number>>((acc, value) => { const key = value || 'Non renseigné'; acc[key] = (acc[key] ?? 0) + 1; return acc }, {})
  const top = (map: Record<string, number>, max: number) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, max).map(([key, count]) => `• ${escapeHtml(key)} : ${count}`).join('\n') || '• —'
  const sections = [`<b>Appareil</b>\n${top(counts(testers.map((t) => t.device)), 10)}`, `<b>Pays / ville (top 5)</b>\n${top(counts(testers.map((t) => t.country_city)), 5)}`]
  for (const key of project.extraColumns) {
    const values = testers.map((t) => String(t.extra?.[key] ?? '')).filter(Boolean); const map = counts(values)
    if (Object.keys(map).length > 0 && Object.keys(map).length <= 10) sections.push(`<b>${escapeHtml(key === 'use_case' ? 'À tester' : 'Cible')}</b>\n${top(map, 10)}`)
  }
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, `<b>${project.label} — ${testers.length} inscrits</b>\n\n${sections.join('\n\n')}`)
}
async function confirmAction(ctx: BotContext, action: 'open' | 'close' | 'quota', project: ProjectConfig, value = 0): Promise<void> {
  const current = action === 'quota' ? await getOverview(ctx.env, project) : undefined
  if (action === 'quota' && (!Number.isInteger(value) || value > 500 || value < (current?.enrolled ?? 0))) throw new HubError('invalid_quota')
  const expiry = Math.floor(Date.now() / 1000) + 300
  const data = await signed(ctx, `c|${action}|${slugChar[project.slug]}|${value}|${expiry}|${shortNonce()}`)
  const verb = action === 'open' ? 'ouvrir' : action === 'close' ? 'fermer' : `fixer l’objectif/maximum à ${value}`
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, `Confirme-tu de <b>${verb}</b> les inscriptions de ${project.label} ?`, [[{ text: 'Confirmer', callback_data: data }, { text: 'Annuler', callback_data: await signed(ctx, `x|${expiry}|${shortNonce()}`) }]])
}
async function exportProjects(ctx: BotContext, projects: ProjectConfig[]): Promise<void> {
  const sheets = await Promise.all(projects.map(async (project) => ({ project, testers: await listAllTesters(ctx.env, project) })))
  const bytes = createWorkbook(sheets)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: String(ctx.env.HUB_TIMEZONE || 'UTC'), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const name = projects.length === 1 ? `beta-${projects[0]!.slug}-${date}.xlsx` : `beta-tout-${date}.xlsx`
  await sendDocument(ctx.env, bot(ctx), ctx.chatId, name, bytes)
}
async function health(ctx: BotContext): Promise<void> {
  const results = await Promise.all(projectChoices.map(async (project) => {
    try { const result = await projectHealth(ctx.env, project); return `• <b>${project.label}</b> : Supabase OK (${result.dbMs} ms) · site ${result.site === null ? 'non configuré' : result.site ? 'OK' : 'injoignable'}` }
    catch { return `• <b>${project.label}</b> : Supabase injoignable` }
  }))
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, `<b>Santé</b>\n${results.join('\n')}`)
}
async function links(ctx: BotContext): Promise<void> {
  const lines = projectChoices.map((project) => {
    const wa = safeHttps(String(ctx.env[`${project.envPrefix}_WHATSAPP_URL`] ?? ''))
    const admin = safeHttps(String(ctx.env[`${project.envPrefix}_ADMIN_URL`] ?? ''))
    const links = [wa ? `<a href="${escapeHtml(wa)}">WhatsApp</a>` : 'WhatsApp non configuré', admin ? `<a href="${escapeHtml(admin)}">Espace admin</a>` : 'Espace admin non configuré']
    return `• <b>${project.label}</b> : ${links.join(' · ')}`
  })
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, lines.join('\n'))
}

async function runCommand(ctx: BotContext, command: string, args: string): Promise<string> {
  const lower = command.toLowerCase()
  if (lower === 'start' || lower === 'aide' || lower === 'help') { await sendMessage(ctx.env, bot(ctx), ctx.chatId, helpText()); return 'help' }
  if (lower === 'stats' || lower === 'projets') { await sendStats(ctx, projectBySlug(args.trim().split(/\s+/)[0] ?? '')); return 'stats' }
  if (lower === 'liste') {
    const { project, filters } = parseListArgs(args, String(ctx.env.HUB_TIMEZONE || 'UTC'))
    if (!project) { await askProject(ctx, 'list', filters); return 'list_project_choice' }
    await showList(ctx, project, filters, 0); return 'list'
  }
  if (lower === 'derniers') { await sendRecent(ctx, args); return 'derniers' }
  if (lower === 'recherche' || lower === 'search') { await searchTesters(ctx, args); return 'recherche' }
  if (lower === 'repartition') {
    const project = projectBySlug(args.trim().split(/\s+/)[0] ?? '')
    if (!project) { await askProject(ctx, 'distribution'); return 'distribution_project_choice' }
    await distribution(ctx, project); return 'repartition'
  }
  if (lower === 'ouvrir' || lower === 'fermer') {
    const project = projectBySlug(args.trim().split(/\s+/)[0] ?? '')
    if (!project) { await askProject(ctx, lower); return `${lower}_project_choice` }
    await confirmAction(ctx, lower === 'ouvrir' ? 'open' : 'close', project); return 'confirm_settings'
  }
  if (lower === 'quota') {
    const [slug, rawValue] = args.trim().split(/\s+/); const project = projectBySlug(slug ?? '')
    const value = Number(rawValue)
    const amount = project ? value : Number(rawValue ?? slug)
    if (!Number.isInteger(amount) || amount < 1 || amount > 500) throw new HubError('invalid_quota')
    if (!project) { await askProject(ctx, 'quota', { value: amount }); return 'quota_project_choice' }
    await confirmAction(ctx, 'quota', project, amount); return 'confirm_quota'
  }
  if (lower === 'sante' || lower === 'health') { await health(ctx); return 'sante' }
  if (lower === 'liens') { await links(ctx); return 'liens' }
  if (lower === 'export' || lower === 'exporttout') {
    if (lower === 'exporttout') { await exportProjects(ctx, projectChoices); return 'export_tout' }
    const project = projectBySlug(args.trim().split(/\s+/)[0] ?? '')
    if (!project) { await askProject(ctx, 'export'); return 'export_project_choice' }
    await exportProjects(ctx, [project]); return 'export'
  }
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, `Commande inconnue. Utilise /aide.\nExemple : « combien on a de monde sur MonMenu ? »`)
  return 'unknown_command'
}

async function handleCallback(ctx: BotContext): Promise<string> {
  const callback = ctx.update.callback_query
  if (!callback?.data) return 'callback_empty'
  const values = await verifyCallback(ctx, callback.data)
  if (!values) { await answerCallback(ctx.env, bot(ctx), callback.id, 'Bouton invalide ou expiré.'); return 'callback_invalid' }
  if (values[0] === 'x') {
    if (!(await markCallbackUsed(ctx.env, values.at(-1) ?? ''))) { await answerCallback(ctx.env, bot(ctx), callback.id, 'Bouton déjà utilisé.'); return 'callback_replayed' }
    await answerCallback(ctx.env, bot(ctx), callback.id, 'Action annulée.'); return 'cancel'
  }
  const nonce = values.at(-1) ?? ''
  if (!(await markCallbackUsed(ctx.env, nonce))) { await answerCallback(ctx.env, bot(ctx), callback.id, 'Bouton déjà utilisé.'); return 'callback_replayed' }
  if (values[0] === 'n') {
    const action = values[1] ?? ''
    await answerCallback(ctx.env, bot(ctx), callback.id)
    if (action === 'stats') await runCommand(ctx, 'stats', '')
    else if (action === 'list') await askProject(ctx, 'list')
    else if (action === 'distribution') await askProject(ctx, 'distribution')
    else if (action === 'export') await askProject(ctx, 'export')
    return `clarify_${action}`
  }
  if (values[0] === 'p') {
    const project = projectBySlug(charSlug[values[2] ?? ''] ?? '')
    const action = values[1] ?? 'list'
    if (!project) { await answerCallback(ctx.env, bot(ctx), callback.id, 'Projet invalide.'); return 'callback_invalid_project' }
    await answerCallback(ctx.env, bot(ctx), callback.id)
    const rawState = await ctx.env.HUB_KV.get(`choice-state:${nonce}`)
    if (rawState) await ctx.env.HUB_KV.delete(`choice-state:${nonce}`)
    const saved = rawState ? JSON.parse(rawState) as { filters?: TesterFilter; value?: number } : {}
    if (action === 'list') {
      await showList(ctx, project, saved.filters ?? (saved as TesterFilter), 0)
    }
    else if (action === 'distribution') await distribution(ctx, project)
    else if (action === 'ouvrir') await confirmAction(ctx, 'open', project)
    else if (action === 'fermer') await confirmAction(ctx, 'close', project)
    else if (action === 'quota') await confirmAction(ctx, 'quota', project, Number(saved.value))
    else if (action === 'export') await exportProjects(ctx, [project])
    return action
  }
  if (values[0] === 'l') {
    const id = values[1] ?? ''; const page = Number(values[2]); const raw = await ctx.env.HUB_KV.get(`list-state:${id}`)
    if (!raw || !Number.isInteger(page) || page < 0) { await answerCallback(ctx.env, bot(ctx), callback.id, 'Cette page a expiré.'); return 'list_expired' }
    const state = JSON.parse(raw) as { project: string; filters: TesterFilter }; const project = projectBySlug(state.project)
    if (!project) { await answerCallback(ctx.env, bot(ctx), callback.id, 'Projet invalide.'); return 'list_invalid_project' }
    await answerCallback(ctx.env, bot(ctx), callback.id)
    await showList(ctx, project, state.filters, page); return 'list_page'
  }
  if (values[0] === 'c') {
    const action = values[1]; const project = projectBySlug(charSlug[values[2] ?? ''] ?? ''); const value = Number(values[3])
    if (!project || !['open', 'close', 'quota'].includes(action ?? '')) { await answerCallback(ctx.env, bot(ctx), callback.id, 'Action invalide.'); return 'callback_invalid_action' }
    await answerCallback(ctx.env, bot(ctx), callback.id)
    if (action === 'open' || action === 'close') {
      const open = action === 'open'; await setOpen(ctx.env, project, open)
      await sendMessage(ctx.env, bot(ctx), ctx.chatId, `Inscriptions ${open ? 'ouvertes' : 'fermées'} pour ${project.label}.`)
    } else {
      const current = await getOverview(ctx.env, project)
      if (!Number.isInteger(value) || value < current.enrolled || value > 500) throw new HubError('invalid_quota')
      await updateTarget(ctx.env, project, value)
      await sendMessage(ctx.env, bot(ctx), ctx.chatId, `${project.label} : ${current.goalOnly ? 'objectif' : 'quota'} réglé à ${value}.`)
    }
    return 'settings_updated'
  }
  await answerCallback(ctx.env, bot(ctx), callback.id, 'Bouton non reconnu.')
  return 'callback_unknown'
}

export async function handleTesteurProjets(ctx: BotContext): Promise<void> {
  const intent = safeIntent(ctx.text)
  if (ctx.update.callback_query) {
    const callbackIntent = await handleCallback(ctx)
    await saveConversationTurn(ctx.env, ctx.botId, ctx.user.id, ctx.update.update_id, '', callbackIntent).catch(() => undefined)
    return
  }
  const command = ctx.text.match(/^\/(\w+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/)
  if (command) {
    try {
      const finalIntent = await runCommand(ctx, command[1] ?? '', command[2] ?? '')
      await saveConversationTurn(ctx.env, ctx.botId, ctx.user.id, ctx.update.update_id, ctx.text, finalIntent).catch(() => undefined)
    } catch (error) {
      const code = error instanceof HubError ? error.code : 'command_error'
      const message = code === 'unknown_project' ? 'Projet inconnu. Choisis MonMenu, Sophiate ou Vimsongre.' : code === 'invalid_quota' ? 'Quota invalide : il doit être au moins égal au nombre d’inscrits et ne pas dépasser 500.' : code === 'invalid_date' ? 'Date invalide. Utilise AAAA-MM-JJ.' : 'Service momentanément indisponible.'
      await sendMessage(ctx.env, bot(ctx), ctx.chatId, message)
      await saveConversationTurn(ctx.env, ctx.botId, ctx.user.id, ctx.update.update_id, ctx.text, intent).catch(() => undefined)
    }
    return
  }
  await handleNaturalLanguage(ctx)
}

const ProjectArg = z.enum(['monmenu', 'sophiate', 'vimsongre'])
const ToolSchemas: Record<string, z.ZodTypeAny> = {
  stats: z.object({ project: ProjectArg.optional() }).strict(),
  liste: z.object({ project: ProjectArg.optional(), device: z.string().max(40).optional(), city: z.string().max(100).optional(), since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
  derniers: z.object({ project: ProjectArg.optional(), count: z.number().int().min(1).max(20).optional() }).strict(),
  recherche: z.object({ query: z.string().min(1).max(120), project: ProjectArg.optional() }).strict(),
  repartition: z.object({ project: ProjectArg.optional() }).strict(),
  export: z.object({ project: ProjectArg.optional() }).strict(),
  export_tout: z.object({}).strict(),
  ouvrir: z.object({ project: ProjectArg.optional() }).strict(),
  fermer: z.object({ project: ProjectArg.optional() }).strict(),
  quota: z.object({ project: ProjectArg.optional(), value: z.number().int().min(1).max(500) }).strict(),
  sante: z.object({}).strict(),
  liens: z.object({}).strict(),
  aide: z.object({}).strict(),
}
const ToolDefinitions = [
  { name: 'stats', description: 'Lire les statistiques de tous les projets ou d’un projet choisi.', input_schema: { type: 'object', properties: { project: { type: 'string', enum: ['monmenu', 'sophiate', 'vimsongre'] } }, additionalProperties: false } },
  { name: 'liste', description: 'Lister les testeurs inscrits, avec filtres facultatifs.', input_schema: { type: 'object', properties: { project: { type: 'string', enum: ['monmenu', 'sophiate', 'vimsongre'] }, device: { type: 'string' }, city: { type: 'string' }, since: { type: 'string', description: 'Date locale AAAA-MM-JJ dans HUB_TIMEZONE.' } }, additionalProperties: false } },
  { name: 'derniers', description: 'Lire les inscriptions les plus récentes.', input_schema: { type: 'object', properties: { project: { type: 'string', enum: ['monmenu', 'sophiate', 'vimsongre'] }, count: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false } },
  { name: 'recherche', description: 'Rechercher un testeur par nom, e-mail ou WhatsApp.', input_schema: { type: 'object', properties: { query: { type: 'string' }, project: { type: 'string', enum: ['monmenu', 'sophiate', 'vimsongre'] } }, required: ['query'], additionalProperties: false } },
  { name: 'repartition', description: 'Calculer la répartition par appareil, ville et champs projet.', input_schema: { type: 'object', properties: { project: { type: 'string', enum: ['monmenu', 'sophiate', 'vimsongre'] } }, additionalProperties: false } },
  { name: 'export', description: 'Exporter un projet en fichier XLSX.', input_schema: { type: 'object', properties: { project: { type: 'string', enum: ['monmenu', 'sophiate', 'vimsongre'] } }, additionalProperties: false } },
  { name: 'export_tout', description: 'Exporter les trois projets dans un classeur XLSX.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'ouvrir', description: 'Demander confirmation pour ouvrir les inscriptions.', input_schema: { type: 'object', properties: { project: { type: 'string', enum: ['monmenu', 'sophiate', 'vimsongre'] } }, additionalProperties: false } },
  { name: 'fermer', description: 'Demander confirmation pour fermer les inscriptions.', input_schema: { type: 'object', properties: { project: { type: 'string', enum: ['monmenu', 'sophiate', 'vimsongre'] } }, additionalProperties: false } },
  { name: 'quota', description: 'Demander confirmation pour changer le quota ou objectif.', input_schema: { type: 'object', properties: { project: { type: 'string', enum: ['monmenu', 'sophiate', 'vimsongre'] }, value: { type: 'integer', minimum: 1, maximum: 500 } }, required: ['value'], additionalProperties: false } },
  { name: 'sante', description: 'Vérifier les connexions Supabase et sites configurés.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'liens', description: 'Afficher les liens WhatsApp et admin configurés.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aide', description: 'Afficher la liste des commandes du bot.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
]

type RoutedTool = { name: string; input: Record<string, unknown> }
async function anthropicRoute(ctx: BotContext, dailyLimit: number): Promise<RoutedTool | undefined> {
  const apiKey = String(ctx.env.ANTHROPIC_API_KEY ?? '')
  if (!apiKey || !(await allowAiCall(ctx.env, ctx.botId, ctx.user.id, ctx.update.update_id, dailyLimit))) return undefined
  let today: string
  try { today = new Intl.DateTimeFormat('fr-FR', { timeZone: String(ctx.env.HUB_TIMEZONE || 'UTC'), dateStyle: 'full' }).format(new Date()) }
  catch { today = new Date().toISOString().slice(0, 10) }
  const messages: { role: 'user' | 'assistant'; content: string }[] = []
  for (const turn of ctx.history.slice(-8)) {
    if (!turn.user) continue
    messages.push({ role: 'user', content: turn.user.slice(0, 240) })
    messages.push({ role: 'assistant', content: `Action précédente : ${turn.intent}. Aucune donnée de testeur n’est incluse.` })
  }
  messages.push({ role: 'user', content: ctx.text.slice(0, 1200) })
  let response: Response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(8_000),
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: String(ctx.env.NL_MODEL || 'claude-haiku-4-5-20251001'), max_tokens: 400,
        system: `Tu es uniquement un routeur d’intentions pour un administrateur autorisé du hub Telegram. Date locale : ${today}; fuseau : ${String(ctx.env.HUB_TIMEZONE || 'UTC')}. Utilise exclusivement les outils fournis, jamais les données personnelles d’un testeur comme contexte. Ne rédige pas de réponse factuelle : le Worker exécutera l’outil et produira la réponse déterministe. Ne déclenche jamais une modification directement; les commandes ouvrir/fermer/quota afficheront toujours une confirmation signée. En cas de projet manquant ou ambigu, laisse le champ project absent afin que le Worker demande un choix. Si la demande n’est pas couverte, n’appelle aucun outil.`,
        messages, tools: ToolDefinitions, tool_choice: { type: 'auto' },
      }),
    })
  } catch { return undefined }
  if (!response.ok) return undefined
  const data = await response.json().catch(() => null) as { content?: { type: string; name?: string; input?: unknown }[] } | null
  const block = data?.content?.find((part) => part.type === 'tool_use' && typeof part.name === 'string')
  if (!block?.name || !Object.hasOwn(ToolSchemas, block.name)) return undefined
  const validated = ToolSchemas[block.name]!.safeParse(block.input)
  if (!validated.success || !validated.data || typeof validated.data !== 'object') return undefined
  return { name: block.name, input: validated.data as Record<string, unknown> }
}

async function executeTool(ctx: BotContext, tool: RoutedTool): Promise<string> {
  const input = tool.input
  const slug = typeof input.project === 'string' ? input.project : ''
  const project = projectBySlug(slug)
  const suffix = project ? ` ${project.slug}` : ''
  if (tool.name === 'stats') return runCommand(ctx, 'stats', suffix.trim())
  if (tool.name === 'aide') return runCommand(ctx, 'aide', '')
  if (tool.name === 'sante') return runCommand(ctx, 'sante', '')
  if (tool.name === 'liens') return runCommand(ctx, 'liens', '')
  if (tool.name === 'export_tout') return runCommand(ctx, 'exporttout', '')
  if (tool.name === 'export') return runCommand(ctx, 'export', suffix.trim())
  if (tool.name === 'ouvrir' || tool.name === 'fermer') return runCommand(ctx, tool.name, suffix.trim())
  if (tool.name === 'quota') {
    if (!project) { await askProject(ctx, 'quota', { value: Number(input.value) }); return 'quota_project_choice' }
    return runCommand(ctx, 'quota', `${project.slug} ${String(input.value ?? '')}`)
  }
  if (tool.name === 'repartition') return runCommand(ctx, 'repartition', suffix.trim())
  if (tool.name === 'derniers') return runCommand(ctx, 'derniers', `${String(input.count ?? 5)}${suffix}`)
  if (tool.name === 'recherche') return runCommand(ctx, 'recherche', `${String(input.query ?? '')}${suffix}`.trim())
  if (tool.name === 'liste') {
    if (!project) { await askProject(ctx, 'list', { filters: { device: input.device, city: input.city, since: input.since ? localMidnightUtc(String(input.since), String(ctx.env.HUB_TIMEZONE || 'UTC')) : undefined } }); return 'list_project_choice' }
    const raw = [project.slug, input.device ? `appareil=${String(input.device)}` : '', input.city ? `ville=${String(input.city)}` : '', input.since ? `depuis=${String(input.since)}` : ''].filter(Boolean).join(' ')
    return runCommand(ctx, 'liste', raw)
  }
  return 'unhandled_tool'
}

function normalize(text: string): string { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() }
function mentionedProject(text: string): ProjectConfig | undefined {
  const normalized = normalize(text)
  return projectChoices.find((project) => normalized.includes(project.slug) || normalized.includes(normalize(project.label)))
}
export function fallbackIntent(text: string): { command: string; args: string } | undefined {
  const value = normalize(text); const project = mentionedProject(text); const slug = project?.slug ?? ''
  if (/\b(ouvre|ouvrir|ouvrir les|reouvrir|reactiver)\b/.test(value)) return { command: 'ouvrir', args: slug }
  if (/\b(ferme les|fermer|ferme|cloturer|desactive)\b/.test(value)) return { command: 'fermer', args: slug }
  if (/\b(quota|objectif|plafond|maximum)\b/.test(value)) {
    const amount = value.match(/\b(\d{1,3})\b/)?.[1]
    return amount ? { command: 'quota', args: `${slug} ${amount}`.trim() } : undefined
  }
  if (/\b(sante|health|etat du site|site fonctionne)\b/.test(value)) return { command: 'sante', args: '' }
  if (/\b(lien|liens|whatsapp|espace admin)\b/.test(value)) return { command: 'liens', args: '' }
  if (/\b(exporte?|exporter|excel|xlsx|telecharger|fichier)\b/.test(value)) return /\b(tous les projets|tout|toutes les bases)\b/.test(value) ? { command: 'exporttout', args: '' } : { command: 'export', args: slug }
  if (/\b(repartition|distribution|par appareil|par ville)\b/.test(value)) return { command: 'repartition', args: slug }
  if (/\b(dernier|derniers|recemment|recent)\b/.test(value)) return { command: 'derniers', args: `5 ${slug}`.trim() }
  const search = value.match(/\b(?:cherche|recherche|trouve|chercher)\s+(?:un|une|le|la|les)?\s*(.+)/)
  if (search?.[1]) {
    let query = search[1].trim()
    if (project) query = query.replace(new RegExp(`\\b(?:sur|dans|de|du|des|pour)\\s+${project.slug}\\b`, 'g'), '').replace(new RegExp(`\\b${project.slug}\\b`, 'g'), '').trim()
    if (query) return { command: 'recherche', args: `${query} ${slug}`.trim() }
  }
  if (/\b(stat|stats|statistique|combien|inscrit|inscriptions|effectif|ouvert|ferme)\b/.test(value)) return { command: 'stats', args: slug }
  if (/\b(liste|inscrits|testeurs|qui est|qui sont)\b/.test(value)) return { command: 'liste', args: slug }
  return undefined
}

async function askClarification(ctx: BotContext): Promise<void> {
  const expiry = Math.floor(Date.now() / 1000) + 300
  const labels = [['Statistiques', 'stats'], ['Liste', 'list'], ['Répartition', 'distribution'], ['Export', 'export']]
  const keyboard: InlineKeyboard = []
  for (const [label, action] of labels) keyboard.push([{ text: label!, callback_data: await signed(ctx, `n|${action}|${expiry}|${shortNonce()}`) }])
  await sendMessage(ctx.env, bot(ctx), ctx.chatId, 'Tu veux consulter quoi ?', keyboard)
}

async function handleNaturalLanguage(ctx: BotContext): Promise<void> {
  const configuredLimit = Number(ctx.env.NL_DAILY_LIMIT ?? 100)
  const limit = Number.isFinite(configuredLimit) ? Math.min(1000, Math.max(0, Math.floor(configuredLimit))) : 100
  try {
    if (ctx.env.ANTHROPIC_API_KEY) {
      const tool = await anthropicRoute(ctx, limit)
      if (tool) {
        const intent = await executeTool(ctx, tool)
        await saveConversationTurn(ctx.env, ctx.botId, ctx.user.id, ctx.update.update_id, ctx.text, intent).catch(() => undefined)
        return
      }
    }
  } catch { /* API indisponible ou outil invalide : repli déterministe. */ }
  const fallback = fallbackIntent(ctx.text)
  if (!fallback) {
    await askClarification(ctx)
    await saveConversationTurn(ctx.env, ctx.botId, ctx.user.id, ctx.update.update_id, ctx.text, 'clarification').catch(() => undefined)
    return
  }
  try {
    const intent = await runCommand(ctx, fallback.command, fallback.args)
    await saveConversationTurn(ctx.env, ctx.botId, ctx.user.id, ctx.update.update_id, ctx.text, intent).catch(() => undefined)
  } catch {
    await sendMessage(ctx.env, bot(ctx), ctx.chatId, 'Service momentanément indisponible. Utilise /aide pour les commandes.')
    await saveConversationTurn(ctx.env, ctx.botId, ctx.user.id, ctx.update.update_id, ctx.text, 'fallback_error').catch(() => undefined)
  }
}
