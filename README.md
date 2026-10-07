# Telegram Bots Hub

Hub multi-bots sur Cloudflare Workers (Hono + TypeScript), avec **Testeurprojets** comme bot principal (`@Testeurprojets_bot`). Le Worker ne sert que `POST /tg/<chemin-secret>`; les autres routes retournent 404. **D1, KV et le socle multi-bot sont conservés volontairement pour les futurs bots et pour la décision d’architecture du propriétaire du dépôt.** Le bot Testeurprojets utilise actuellement `HUB_KV` pour son état court et ses contrôles, sans supprimer les modules D1/KV existants.

## Fonctionnalités livrées

Commandes : `/start`, `/aide`, `/stats` (`/projets`), `/liste <projet> [appareil=…] [ville=…] [depuis=AAAA-MM-JJ]`, `/derniers [n] [projet]`, `/recherche <texte> [projet]`, `/repartition <projet>`, `/export <projet> [filtres]`, `/exporttout [filtres]`, `/ouvrir <projet>`, `/fermer <projet>`, `/quota <projet> <n>`, `/sante`, `/liens`. Les dates sont interprétées dans `HUB_TIMEZONE`. Le langage naturel est traité en français par un routeur d’outils compatible avec Anthropic, OpenAI ou Gemini (`NL_PROVIDER=auto` choisit le premier fournisseur configuré). Zod valide les arguments, le modèle ne reçoit aucune ligne de testeur et ne génère pas de faits. Si aucun fournisseur n’est configuré, s’il échoue ou si le plafond quotidien est atteint, un routeur déterministe couvre les intentions principales et demande une clarification signée quand nécessaire.

Les statistiques, listes, recherches, répartitions et XLSX utilisent les Supabase déjà définis par les trois dépôts. `MonMenu` utilise `maximum_testers` comme objectif informatif et `registrations_open`; `Sophiate` utilise le plafond dur `max_testers` et `is_open`; `Vimsongre` utilise l’objectif informatif `recruitment_goal` et `is_open`. Les champs métier extra conservés sont `use_case` (Sophiate) et `test_target` (Vimsongre). L’export XLSX contient les colonnes réellement disponibles et neutralise les cellules qui commencent par un caractère de formule. Voir [l’audit source](docs/PROJECT_SOURCE_AUDIT.md).

Les changements d’ouverture et de quota passent toujours par un bouton de confirmation signé; le minimum de quota est le nombre d’inscrits et le maximum est 500. Pour MonMenu/Vimsongre, la valeur reste un objectif, pas une limite d’inscription. Les valeurs callback sont HMAC, expirent après 5 minutes et sont à usage unique. Le webhook compare le secret Telegram en temps constant, n’accepte que l’admin autorisé en conversation privée, déduplique les updates et limite à 30 messages/minute. L’accusé HTTP 200 est rapide; le traitement et les exports s’exécutent avec `waitUntil`.

Les logs ne contiennent ni texte de message ni données de testeurs. KV conserve des clés de déduplication (24 h), limites quotidiennes (48 h), boutons (5 min) et au plus huit entrées d’historique admin (24 h), jamais les lignes lues dans Supabase. Les requêtes admin peuvent elles-mêmes contenir des termes de recherche; gardez `HUB_KV` privé. Cloudflare limite `waitUntil` à 30 secondes après la réponse HTTP; si les exports deviennent assez volumineux pour dépasser cette durée, il faudra un traitement Queue distinct.

## Configuration

Les fichiers [`.env.example`](.env.example) et [`.dev.vars.example`](.dev.vars.example) ne contiennent que les noms de variables, sans valeurs. Copiez `.dev.vars.example` vers `.dev.vars` pour le développement local; ce dernier est ignoré par Git. Les variables non secrètes (`PUBLIC_BASE_URL`, `HUB_TIMEZONE`, `NL_MODEL`, `NL_DAILY_LIMIT`, URLs Supabase/sites/liens) sont sous `vars` dans `wrangler.jsonc` ou dans les variables du tableau de bord Cloudflare. Le `wrangler` épinglé ici ne fournit pas de commande `wrangler vars put`; cela a été vérifié avec `wrangler --help`. Ne lancez pas une commande non disponible : modifiez `wrangler.jsonc` puis redéployez, ou utilisez le tableau de bord.

Secrets à définir séparément avec Wrangler :

```bash
pnpm exec wrangler secret put HUB_ADMIN_IDS
pnpm exec wrangler secret put HUB_CALLBACK_SECRET
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm exec wrangler secret put OPENAI_API_KEY
pnpm exec wrangler secret put GEMINI_API_KEY
pnpm exec wrangler secret put BOT_TESTEURPROJETS_TOKEN
pnpm exec wrangler secret put BOT_TESTEURPROJETS_WEBHOOK_SECRET
pnpm exec wrangler secret put BOT_TESTEURPROJETS_WEBHOOK_PATH
pnpm exec wrangler secret put MONMENU_SUPABASE_SERVICE_KEY
pnpm exec wrangler secret put SOPHIATE_SUPABASE_SERVICE_KEY
pnpm exec wrangler secret put VIMSONGRE_SUPABASE_SERVICE_KEY
```

L’identifiant Telegram `6730264801` est toujours autorisé, uniquement en conversation privée. Aucun autre identifiant ne fonctionne par défaut. Pour ajouter explicitement un administrateur, ajoutez son identifiant dans `HUB_ADMIN_IDS` (ou dans `BOT_TESTEURPROJETS_ADMIN_IDS` pour ce bot), séparé par des virgules. Ces listes s’ajoutent à l’ID obligatoire de Samuel ; elles ne le remplacent jamais. Générer `HUB_CALLBACK_SECRET`, le chemin webhook et le secret Telegram comme valeurs aléatoires fortes d’au moins 32 caractères autorisés (`A-Z`, `a-z`, chiffres, `_`, `-`). Ne journalisez ni ne commitez ces valeurs.

## Vérifications locales

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

CI exécute les mêmes vérifications sur `main`. Les tests couvrent les différences de schéma, les dates avec fuseau, le fallback naturel, l’échappement HTML et le conteneur XLSX. Pour développer : renseigner les bindings IDs dans `wrangler.jsonc`, renseigner `.dev.vars`, puis lancer `pnpm dev`.

## Déploiement manuel

1. Dans `wrangler.jsonc`, remplacer les IDs placeholders par les IDs **existants** de D1 et `BOT_KV` (ils sont conservés, pas réinitialisés), créer/relier le namespace `HUB_KV` requis, et fixer `PUBLIC_BASE_URL` au domaine Worker réel. Aucun D1 neuf ne doit être créé et aucune migration D1 ne doit être appliquée par ce bot.
2. Renseigner dans `vars` les URLs Supabase des trois projets, les URL de site/liens facultatives, `HUB_TIMEZONE` (identifiant IANA) et `NL_DAILY_LIMIT`. Les clés `service_role` restent des secrets.
3. Injecter les secrets avec les commandes ci-dessus, puis déployer :

   ```bash
   pnpm exec wrangler deploy
   ```

4. Pour enregistrer le webhook Telegram après le déploiement, placer temporairement les valeurs nécessaires dans `.dev.vars` (fichier ignoré) ou les exporter dans l’environnement, définir `PUBLIC_BASE_URL` sur le domaine déployé, puis exécuter :

   ```bash
   set -a
   . ./.dev.vars
   set +a
   pnpm webhooks:register
   ```

   Le script appelle `setWebhook` avec `secret_token`, `allowed_updates: ["message", "callback_query"]` et l’URL `/tg/<chemin-secret>`; il ne journalise ni token ni chemin. Il ne supprime pas les updates en attente.

## Ajouter un bot

Créer `src/bots/<nouveau-bot>/`, définir les secrets `BOT_<ID>_TOKEN`, `BOT_<ID>_WEBHOOK_SECRET`, `BOT_<ID>_WEBHOOK_PATH` et, si nécessaire, `BOT_<ID>_ADMIN_IDS`, puis ajouter une entrée d’une ligne dans `src/registry.ts` via `defineBot(...)` et un import dynamique du dossier du bot. Le routeur, la validation du webhook et le script `setWebhook` restent inchangés. Les adaptations futures de D1 et des autres bots legacy peuvent rester isolées.

## Références officielles

[Telegram Bot API](https://core.telegram.org/bots/api) · [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages) · [Modèles Anthropic](https://platform.claude.com/docs/en/models/overview) · [Cloudflare `waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/) · [Cloudflare KV writes](https://developers.cloudflare.com/kv/api/write-key-value-pairs/) · [Configuration Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/) · [Secrets Workers](https://developers.cloudflare.com/workers/configuration/secrets/).
