import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'))

const required = [
  ['D1 database_id', config.d1_databases?.[0]?.database_id],
  ['BOT_KV namespace id', config.kv_namespaces?.find(({ binding }) => binding === 'BOT_KV')?.id],
  ['HUB_KV namespace id', config.kv_namespaces?.find(({ binding }) => binding === 'HUB_KV')?.id],
  ['PUBLIC_BASE_URL', config.vars?.PUBLIC_BASE_URL],
]

const missing = required.filter(([, value]) => {
  if (typeof value !== 'string' || value.trim() === '') return true
  if (/REPLACE_WITH|<[^>]+>/i.test(value)) return true
  return false
})

if (missing.length > 0) {
  console.error('Déploiement Cloudflare impossible : configuration non renseignée.')
  for (const [name] of missing) console.error(`- ${name}`)
  console.error('\nRemplacez ces exemples par les valeurs réelles des ressources du compte Cloudflare ciblé.')
  console.error('Un faux ID KV/D1 ne peut pas fonctionner : Cloudflare vérifie que la ressource existe (erreur 10042).')
  process.exit(1)
}

console.log('Configuration Cloudflare renseignée. Wrangler vérifiera les ressources lors du déploiement.')
