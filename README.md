# Telegram Bots Hub

Hub serverless Cloudflare Workers pour plusieurs bots Telegram indépendants. Le code est conçu pour dépasser dix bots : chaque bot possède son identifiant, son secret, son token, sa logique et ses états D1 propres.

## Premier lot livré

- Worker Hono TypeScript et endpoints `/health`, `/webhook/:botId`, `/admin`.
- Trois logiques distinctes : `registration`, `ai-chat`, `test-bot`.
- Vérification obligatoire de `X-Telegram-Bot-Api-Secret-Token`.
- `allowed_updates` limité à `message` et `callback_query`.
- Persistance D1 des événements, conversations et métriques.
- KV prévu pour rate limiting/cache dans le lot suivant.
- Rate limiting KV par bot et conversation.
- Registre externe `BOT_REGISTRY_JSON` pour ajouter des bots sans modifier le routeur.
- Adaptateurs isolés pour MonMenu, Sophiate et Vimsongre dans `src/projects.ts`.
- Modèle IA par défaut : `claude-haiku-4-5-20251001`, identifiant officiel actuel rapide/économique ; surcharge possible par `ANTHROPIC_MODEL`.

## Différences des projets sources

Les règles métier de MonMenu, Sophiate et Vimsongre sont **préservées**. Le hub ne normalise pas leurs limites : un adaptateur propre à chaque projet conservera les objectifs, plafonds, champs `device`, fonctions RPC et statuts propres à chaque dépôt.

Les adaptateurs encodent explicitement : MonMenu objectif sans plafond (20), Sophiate plafond dur (50), Vimsongre objectif sans plafond (20). Les URLs et tokens d’adaptateurs restent des secrets/configurations runtime.

Pour ajouter 10 bots ou davantage, renseigner `BOT_REGISTRY_JSON` avec des objets `{ "id", "name", "logic", "enabled" }`. Les tokens et secrets suivent le même schéma `TELEGRAM_BOT_TOKEN_<ID>` / `TELEGRAM_WEBHOOK_SECRET_<ID>`.

## Installation

```bash
pnpm install
pnpm run typecheck
pnpm run db:migrate:local
pnpm run dev
```

Créer D1/KV puis remplacer les identifiants de `wrangler.jsonc`. Les secrets doivent être injectés avec Wrangler, jamais dans Git :

```bash
pnpm wrangler secret put ADMIN_TOKEN
pnpm wrangler secret put ANTHROPIC_API_KEY
pnpm wrangler secret put TELEGRAM_BOT_TOKEN_REGISTRATION
pnpm wrangler secret put TELEGRAM_WEBHOOK_SECRET_REGISTRATION
pnpm wrangler secret put TELEGRAM_BOT_TOKEN_AI_CHAT
pnpm wrangler secret put TELEGRAM_WEBHOOK_SECRET_AI_CHAT
pnpm wrangler secret put TELEGRAM_BOT_TOKEN_TEST_BOT
pnpm wrangler secret put TELEGRAM_WEBHOOK_SECRET_TEST_BOT
```

Puis configurer `PUBLIC_BASE_URL` et enregistrer les webhooks :

```bash
curl -X POST "$PUBLIC_BASE_URL/admin/webhooks/register" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Ne jamais copier les tokens Telegram, Anthropic ou GitHub dans une issue, un commit ou un fichier versionné.

## Sources techniques consultées

- Telegram Bot API : `setWebhook`, secret token, `allowed_updates`, `sendMessage`, `answerCallbackQuery`.
- Anthropic Models Overview : identifiants et choix de modèle Claude Haiku.
- Cloudflare Workers : `ctx.waitUntil`, secrets Wrangler, bindings D1/KV.
