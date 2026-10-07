import type { Env } from './types'

export type ProjectId = 'monmenu' | 'sophiate' | 'vimsongre'
export type ProjectBetaRules = {
  projectId: ProjectId
  overviewRpc: string
  registerRpc: string
  closeRpc: string
  deviceValues: string[]
  target: 'goal-only' | 'hard-cap'
  initialGoal: number
  maxTesters?: number
}
export const PROJECT_ADAPTERS: Record<ProjectId, ProjectBetaRules> = {
  monmenu: { projectId: 'monmenu', overviewRpc: 'beta_get_overview', registerRpc: 'beta_register_tester', closeRpc: 'beta_set_open', deviceValues: ['android', 'ios', 'ordinateur'], target: 'goal-only', initialGoal: 20 },
  sophiate: { projectId: 'sophiate', overviewRpc: 'get_beta_overview', registerRpc: 'register_beta_tester', closeRpc: 'set_beta_collection_open', deviceValues: ['android', 'ios', 'computer'], target: 'hard-cap', initialGoal: 50, maxTesters: 50 },
  vimsongre: { projectId: 'vimsongre', overviewRpc: 'beta_overview', registerRpc: 'beta_register', closeRpc: 'beta_set_open', deviceValues: ['Android', 'iOS', 'Ordinateur'], target: 'goal-only', initialGoal: 20 }
}

export function projectRules(projectId: string): ProjectBetaRules | undefined { return PROJECT_ADAPTERS[projectId as ProjectId] }
export function configuredProjectUrl(env: Env, projectId: ProjectId): string { return String(env[`PROJECT_${projectId.toUpperCase()}_BETA_API_URL`] ?? '') }
export function configuredProjectToken(env: Env, projectId: ProjectId): string { return String(env[`PROJECT_${projectId.toUpperCase()}_ADAPTER_TOKEN`] ?? '') }
export async function callProjectAdapter(env: Env, projectId: ProjectId, operation: string, payload: Record<string, unknown>): Promise<unknown> {
  const url = configuredProjectUrl(env, projectId)
  const token = configuredProjectToken(env, projectId)
  if (!url || !token) throw new Error(`Adaptateur ${projectId} non configuré`)
  const response = await fetch(`${url.replace(/\/$/, '')}/${operation}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(payload) })
  if (!response.ok) throw new Error(`Adaptateur ${projectId}: HTTP ${response.status}`)
  return response.json()
}
