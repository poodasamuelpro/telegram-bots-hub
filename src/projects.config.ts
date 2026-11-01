export type ProjectSlug = 'monmenu' | 'sophiate' | 'vimsongre' | 'izicard'

export type ProjectConfig = {
  slug: ProjectSlug
  label: string
  envPrefix: string
  overviewRpc: string
  openRpc: string
  openArg: string
  countField: string
  targetField: string
  openField: string
  targetColumn: string
  openColumn: string
  settingsKeyColumn: string
  settingsKeyValue: string
  goalOnly: boolean
  extraColumns: string[]
  devices: string[]
}

export const PROJECTS: Record<ProjectSlug, ProjectConfig> = {
  monmenu: {
    slug: 'monmenu', label: 'MonMenu', envPrefix: 'MONMENU',
    overviewRpc: 'beta_get_overview', openRpc: 'beta_set_open', openArg: 'p_open',
    countField: 'enrolled', targetField: 'maximum', openField: 'open',
    targetColumn: 'maximum_testers', openColumn: 'registrations_open',
    settingsKeyColumn: 'id', settingsKeyValue: 'true', goalOnly: true,
    extraColumns: [], devices: ['android', 'ios', 'ordinateur'],
  },
  sophiate: {
    slug: 'sophiate', label: 'Sophiate', envPrefix: 'SOPHIATE',
    overviewRpc: 'get_beta_overview', openRpc: 'set_beta_collection_open', openArg: 'p_is_open',
    countField: 'registered_count', targetField: 'maximum', openField: 'is_open',
    targetColumn: 'max_testers', openColumn: 'is_open',
    settingsKeyColumn: 'id', settingsKeyValue: 'true', goalOnly: false,
    extraColumns: ['use_case'], devices: ['android', 'ios', 'computer'],
  },
  vimsongre: {
    slug: 'vimsongre', label: 'Vimsongre', envPrefix: 'VIMSONGRE',
    overviewRpc: 'beta_overview', openRpc: 'beta_set_open', openArg: 'p_is_open',
    countField: 'registered', targetField: 'goal', openField: 'is_open',
    targetColumn: 'recruitment_goal', openColumn: 'is_open',
    settingsKeyColumn: 'singleton', settingsKeyValue: 'true', goalOnly: true,
    extraColumns: ['test_target'], devices: ['Android', 'iOS', 'Ordinateur'],
  },
  izicard: {
    slug: 'izicard', label: 'IziCard', envPrefix: 'IZICARD',
    overviewRpc: 'beta_overview', openRpc: 'beta_set_open', openArg: 'p_is_open',
    countField: 'registered', targetField: 'goal', openField: 'is_open',
    targetColumn: 'recruitment_goal', openColumn: 'is_open',
    settingsKeyColumn: 'singleton', settingsKeyValue: 'true', goalOnly: true,
    extraColumns: ['google_email', 'already_client'], devices: ['Android', 'iOS'],
  },
}

/** Libellé lisible d'un champ propre à un projet (colonnes « extra »). */
export function extraLabel(key: string): string {
  const labels: Record<string, string> = {
    use_case: 'À tester',
    test_target: 'Cible',
    google_email: 'Compte Google',
    already_client: 'Déjà client',
  }
  return labels[key] ?? key
}

export function projectFromSlug(value: string | undefined): ProjectConfig | undefined {
  return value && Object.hasOwn(PROJECTS, value) ? PROJECTS[value as ProjectSlug] : undefined
}
