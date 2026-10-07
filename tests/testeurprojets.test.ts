import { describe, expect, it } from 'vitest'
import { escapeHtml, constantTimeEqual, safeIntent } from '../src/core/security'
import { PROJECTS } from '../src/projects.config'
import { createWorkbook } from '../src/core/xlsx'
import { fallbackIntent, localMidnightUtc, parseExportArgs, parseListArgs } from '../src/bots/testeurprojets'
import type { Tester } from '../src/core/supabase'

describe('adaptateurs des projets bêta', () => {
  it('préserve les objectifs informatifs de MonMenu/Vimsongre et le plafond Sophiate', () => {
    expect(PROJECTS.monmenu.goalOnly).toBe(true)
    expect(PROJECTS.sophiate.goalOnly).toBe(false)
    expect(PROJECTS.vimsongre.goalOnly).toBe(true)
    expect(PROJECTS.sophiate.extraColumns).toContain('use_case')
    expect(PROJECTS.vimsongre.extraColumns).toContain('test_target')
  })
})

describe('dates et filtres', () => {
  it('convertit minuit local avec le fuseau configuré', () => {
    expect(localMidnightUtc('2026-01-01', 'Africa/Ouagadougou')).toBe('2026-01-01T00:00:00.000Z')
    expect(localMidnightUtc('2026-01-01', 'America/Los_Angeles')).toBe('2026-01-01T08:00:00.000Z')
    expect(localMidnightUtc('2026-07-15', 'America/Los_Angeles')).toBe('2026-07-15T07:00:00.000Z')
  })
  it('rejette les dates calendaires impossibles', () => {
    expect(() => localMidnightUtc('2026-02-31', 'UTC')).toThrow('invalid_date')
  })
  it('parse les filtres appareil, ville et date locale', () => {
    const result = parseListArgs('monmenu appareil=android ville=Ouagadougou depuis=2026-01-01', 'America/Los_Angeles')
    expect(result.project?.slug).toBe('monmenu')
    expect(result.filters).toEqual({ device: 'android', city: 'Ouagadougou', since: '2026-01-01T08:00:00.000Z' })
  })
  it('parse les mêmes filtres pour un export et rejette un projet inconnu', () => {
    expect(parseExportArgs('sophiate appareil=computer ville=Paris depuis=2026-01-01', 'UTC')).toEqual({
      project: PROJECTS.sophiate,
      filters: { device: 'computer', city: 'Paris', since: '2026-01-01T00:00:00.000Z' },
    })
    expect(parseExportArgs('appareil=ios depuis=2026-01-01', 'UTC').filters.device).toBe('ios')
    expect(() => parseExportArgs('sophiaat', 'UTC')).toThrow('unknown_project')
  })
})

describe('repli déterministe du langage naturel', () => {
  it('route les changements d’état vers une commande qui demande confirmation', () => {
    expect(fallbackIntent('Ferme les inscriptions sur MonMenu')).toEqual({ command: 'fermer', args: 'monmenu' })
    expect(fallbackIntent('Fixe l’objectif de Vimsongre à 40')).toEqual({ command: 'quota', args: 'vimsongre 40' })
  })
  it('reconnaît les consultations, recherches et exports explicites', () => {
    expect(fallbackIntent('Combien de testeurs sont inscrits ?')?.command).toBe('stats')
    expect(fallbackIntent('Combien de testeurs sur MonMenu ?')).toEqual({ command: 'stats', args: 'monmenu' })
    expect(fallbackIntent('Cherche Alice sur Sophiate')).toEqual({ command: 'recherche', args: 'alice sophiate' })
    expect(fallbackIntent('Exporte tous les projets')?.command).toBe('exporttout')
    expect(fallbackIntent('Affiche les derniers inscrits sur MonMenu')?.args).toBe('5 monmenu')
  })
  it('demande une clarification pour une intention non couverte', () => {
    expect(fallbackIntent('Bonjour, peux-tu m’aider ?')).toBeUndefined()
  })
  it.each([
    ['Combien de monde sur MonMenu ?', 'stats'],
    ['Quel est le nombre d’inscrits sur Sophiate ?', 'stats'],
    ['Montre-moi les statistiques', 'stats'],
    ['Il reste combien de places partout ?', 'stats'],
    ['Qui sont les testeurs de Vimsongre ?', 'liste'],
    ['Affiche la liste des inscrits', 'liste'],
    ['Qui s’est inscrit aujourd’hui ?', 'liste'],
    ['Montre les derniers inscrits de MonMenu', 'derniers'],
    ['Donne-moi les testeurs récents de Sophiate', 'derniers'],
    ['Les derniers inscrits sur Vimsongre', 'derniers'],
    ['Cherche Ouédraogo', 'recherche'],
    ['Recherche Alice dans Sophiate', 'recherche'],
    ['Trouve le numéro +22670000000', 'recherche'],
    ['Envoie-moi l’excel de tous les projets', 'exporttout'],
    ['Télécharge le fichier Excel de MonMenu', 'export'],
    ['Exporte les inscrits de Sophiate', 'export'],
    ['Je veux le fichier des testeurs', 'export'],
    ['Répartition par appareil de Vimsongre', 'repartition'],
    ['Donne la distribution par ville de MonMenu', 'repartition'],
    ['Ouvre les inscriptions de MonMenu', 'ouvrir'],
    ['Réouvre Sophiate', 'ouvrir'],
    ['Ferme les inscriptions de Sophiate', 'fermer'],
    ['Désactive la collecte Vimsongre', 'fermer'],
    ['Passe le quota de Sophiate à 30', 'quota'],
    ['Fixe l’objectif de Vimsongre à 40', 'quota'],
    ['Mets le maximum de MonMenu à 25', 'quota'],
    ['Le site fonctionne-t-il ?', 'sante'],
    ['Donne-moi l’état du site', 'sante'],
    ['Affiche les liens WhatsApp', 'liens'],
    ['Je veux le lien de l’espace admin', 'liens'],
  ])('reconnaît : %s', (phrase, command) => {
    expect(fallbackIntent(phrase)?.command).toBe(command)
  })
})

describe('sécurité des sorties', () => {
  it('échappe le HTML reçu des bases et compare les secrets sans égalité précoce', () => {
    expect(escapeHtml(`<script a="b">&'`)).toBe('&lt;script a=&quot;b&quot;&gt;&amp;&#39;')
    expect(constantTimeEqual('secret', 'secret')).toBe(true)
    expect(constantTimeEqual('secret', 'secreu')).toBe(false)
    expect(safeIntent('/recherche jean@example.com')).toBe('recherche')
  })
  it('produit un classeur XLSX ZIP et neutralise les valeurs de formule', () => {
    const tester: Tester = { id: '1', full_name: '=HYPERLINK("https://example.invalid")', email: 'a@example.invalid', whatsapp: '+12345678901', country_city: 'Paris', device: 'ios', extra: {}, consent_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }
    const bytes = createWorkbook([{ project: PROJECTS.monmenu, testers: [tester] }])
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(new TextDecoder().decode(bytes)).toContain('&apos;=HYPERLINK')
  })
})
