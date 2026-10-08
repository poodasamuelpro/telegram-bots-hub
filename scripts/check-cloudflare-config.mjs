import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'))
const bindings = new Set((config.kv_namespaces ?? []).map(({ binding }) => binding))
const missingKv = ['BOT_KV', 'HUB_KV'].filter((name) => !bindings.has(name))
const missingDb = !(config.d1_databases ?? []).some(({ binding }) => binding === 'DB')
const workerUrl = String(config.vars?.PUBLIC_BASE_URL ?? '')

if (missingKv.length || missingDb) {
  console.warn('Mode temporaire sans stockage Cloudflare configuré :')
  for (const name of missingKv) console.warn(`- ${name} utilise un stockage mémoire éphémère, propre à une instance Worker.`)
  if (missingDb) console.warn('- DB/D1 est absent; les fonctions historiques qui le requièrent ne seront pas utilisables.')
  console.warn('Les données mémoire ne sont ni persistantes ni partagées entre instances. Ajoutez les bindings réels avant un usage de production.')
}
if (!workerUrl || /REPLACE_WITH|<[^>]+>/i.test(workerUrl)) {
  console.warn('- PUBLIC_BASE_URL reste un exemple : définissez le domaine réel avant d’enregistrer le webhook Telegram.')
}
console.log('Précontrôle terminé; aucun ID fictif n’est envoyé à Cloudflare.')
