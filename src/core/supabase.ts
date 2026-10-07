import { z } from 'zod'
import { PROJECTS, type ProjectConfig, type ProjectSlug } from '../projects.config'
import type { Env } from '../types'
import { HubError } from '../types'

const TesterSchema = z.object({
  id: z.string(), full_name: z.string(), email: z.string(), whatsapp: z.string(), country_city: z.string(),
  device: z.string(), extra: z.record(z.unknown()).default({}), consent_at: z.string(), created_at: z.string(),
})
export type Tester = z.infer<typeof TesterSchema>
export type Overview = { project: ProjectSlug; enrolled: number; target: number; remaining: number; isOpen: boolean; goalOnly: boolean }
export type TesterFilter = { device?: string; city?: string; since?: string; query?: string }

function required(env: Env, name: string): string {
  const value = String(env[name] ?? '').trim()
  if (!value) throw new HubError('project_config_missing')
  return value.replace(/\/$/, '')
}
function config(env: Env, project: ProjectConfig): { url: string; key: string } {
  return { url: required(env, `${project.envPrefix}_SUPABASE_URL`), key: required(env, `${project.envPrefix}_SUPABASE_SERVICE_KEY`) }
}
async function request(env: Env, project: ProjectConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const { url, key } = config(env, project)
  let response: Response
  try {
    response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(8_000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  } catch { throw new HubError('project_unreachable') }
  if (!response.ok) throw new HubError(`project_http_${response.status}`)
  return response
}
async function rpc(env: Env, project: ProjectConfig, name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await request(env, project, `rpc/${name}`, { method: 'POST', body: JSON.stringify(body) })
  const data = await response.json() as unknown
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') throw new HubError('project_response_invalid')
  return row as Record<string, unknown>
}

export async function getOverview(env: Env, project: ProjectConfig): Promise<Overview> {
  const row = await rpc(env, project, project.overviewRpc, {})
  const enrolled = Number(row[project.countField] ?? 0)
  const target = Number(row[project.targetField] ?? 0)
  const remaining = Number(row.remaining ?? Math.max(target - enrolled, 0))
  return { project: project.slug, enrolled, target, remaining: Math.max(remaining, 0), isOpen: Boolean(row[project.openField]), goalOnly: project.goalOnly }
}
export async function setOpen(env: Env, project: ProjectConfig, open: boolean): Promise<boolean> {
  const row = await rpc(env, project, project.openRpc, { [project.openArg]: open })
  return Boolean(row.is_open ?? row.open ?? open)
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_*(),]/g, (char) => `\\${char}`)
}
function testerQuery(filters: TesterFilter, limit: number, offset: number): string {
  const params = new URLSearchParams()
  params.set('select', ['id', 'full_name', 'email', 'whatsapp', 'country_city', 'device', 'extra', 'consent_at', 'created_at'].join(','))
  params.set('order', 'created_at.desc')
  params.set('limit', String(limit)); params.set('offset', String(offset))
  if (filters.device) params.set('device', `eq.${filters.device}`)
  if (filters.city) params.set('country_city', `ilike.*${escapeLike(filters.city)}*`)
  if (filters.since) params.set('created_at', `gte.${filters.since}`)
  if (filters.query) {
    const q = escapeLike(filters.query)
    params.set('or', `(full_name.ilike.*${q}*,email.ilike.*${q}*,whatsapp.ilike.*${q}*)`)
  }
  return `beta_testers?${params.toString()}`
}
export async function listTesters(env: Env, project: ProjectConfig, filters: TesterFilter = {}, limit = 5, offset = 0): Promise<Tester[]> {
  const response = await request(env, project, testerQuery(filters, limit, offset), { method: 'GET' })
  const data = await response.json() as unknown
  if (!Array.isArray(data)) throw new HubError('project_response_invalid')
  return data.map((row) => TesterSchema.parse(row))
}
export async function listAllTesters(env: Env, project: ProjectConfig, filters: TesterFilter = {}): Promise<Tester[]> {
  const all: Tester[] = []
  for (let offset = 0; ; offset += 1000) {
    const page = await listTesters(env, project, filters, 1000, offset)
    all.push(...page)
    if (page.length < 1000) return all
  }
}
export async function updateTarget(env: Env, project: ProjectConfig, target: number): Promise<void> {
  const { url, key } = config(env, project)
  const params = new URLSearchParams({ [project.settingsKeyColumn]: `eq.${project.settingsKeyValue}` })
  let response: Response
  try {
    response = await fetch(`${url}/rest/v1/beta_settings?${params.toString()}`, {
      method: 'PATCH', signal: AbortSignal.timeout(8_000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ [project.targetColumn]: target, updated_at: new Date().toISOString() }),
    })
  } catch { throw new HubError('project_unreachable') }
  if (!response.ok) throw new HubError(`project_http_${response.status}`)
}
export async function projectHealth(env: Env, project: ProjectConfig): Promise<{ dbMs: number; site: boolean | null }> {
  const started = Date.now()
  await getOverview(env, project)
  const dbMs = Date.now() - started
  const siteUrl = String(env[`${project.envPrefix}_SITE_URL`] ?? '').trim()
  if (!siteUrl) return { dbMs, site: null }
  try {
    const response = await fetch(siteUrl, { method: 'HEAD', signal: AbortSignal.timeout(5_000) })
    return { dbMs, site: response.ok }
  } catch { return { dbMs, site: false } }
}
export function projectBySlug(slug: string): ProjectConfig | undefined {
  return Object.hasOwn(PROJECTS, slug) ? PROJECTS[slug as ProjectSlug] : undefined
}
