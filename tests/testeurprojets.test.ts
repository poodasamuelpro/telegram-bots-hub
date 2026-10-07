import { describe, expect, it } from 'vitest'
import { escapeHtml, constantTimeEqual, safeIntent } from '../src/core/security'
import { PROJECTS } from '../src/projects.config'
import { createWorkbook } from '../src/core/xlsx'
import { fallbackIntent, localMidnightUtc, parseListArgs } from '../src/bots/testeurprojets'
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
