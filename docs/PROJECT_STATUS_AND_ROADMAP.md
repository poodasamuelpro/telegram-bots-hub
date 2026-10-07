# État du projet, configuration manuelle et feuille de route

Date de référence : 2026-10-07

## 1. Résumé honnête

Le dépôt contient un **MVP technique fonctionnel** du hub Telegram : Worker Hono, routage multi-bots, sécurité webhook, D1, KV, trois logiques de bots, mémoire courte IA, rate limiting, métriques et adaptateurs de projets.

Il n’est pas encore une plateforme de production entièrement opérationnelle, car les ressources Cloudflare, les secrets, les vrais bots Telegram et les connexions aux trois projets doivent encore être configurés manuellement puis testés bout en bout.

Les dépôts suivants n’ont pas été modifiés :

- MonMenu
- Sophiate
- Vimsongre

## 2. Pourquoi D1 ?

D1 est la base SQL persistante du hub. Elle conserve :

- les événements Telegram reçus ;
- les conversations et la mémoire courte de chaque bot ;
- les métriques quotidiennes ;
- les erreurs et l’historique technique ;
- les instances et configurations de bots.

KV est utilisé pour les compteurs rapides de rate limiting et pourra servir de cache. Les secrets Wrangler contiennent les tokens et clés sensibles. Cette séparation évite de mettre des secrets dans le code ou dans la base métier.

## 3. Fonctionnalités déjà présentes

### Socle technique

- Cloudflare Worker avec Hono et TypeScript strict ;
- `GET /health` ;
- `GET /` ;
- `POST /webhook/:botId` ;
- authentification des webhooks par `X-Telegram-Bot-Api-Secret-Token` ;
- prise en charge de `message` et `callback_query` ;
- réponses Telegram avec texte et boutons inline ;
- gestion des erreurs sans exposer les détails au visiteur.

### Multi-bots

- registre de bots extensible ;
- trois bots initiaux avec logiques séparées :
  - `registration` : inscriptions et commandes d’aide ;
  - `ai-chat` : assistant Claude avec mémoire courte ;
  - `test-bot` : diagnostic des messages, callbacks et webhook ;
- ajout de bots par `BOT_REGISTRY_JSON` sans modifier le routeur ;
- tokens et secrets séparés par bot ;
- enregistrement des webhooks pour tous les bots activés.

### Données et sécurité

- migration D1 versionnée ;
- événements et métriques persistants ;
- conversations isolées par `bot_id` et `chat_id` ;
- rate limiting KV par bot et conversation ;
- secrets exclus de Git ;
- token d’administration par `ADMIN_TOKEN` ;
- mémoire IA limitée pour éviter une croissance illimitée des prompts.

### Projets existants

Les contrats des trois projets sont conservés séparément :

| Projet | RPC d’inscription | Règle de limite | Valeurs appareil |
|---|---|---|---|
| MonMenu | `beta_register_tester` | Objectif 20, sans plafond automatique | `android`, `ios`, `ordinateur` |
| Sophiate | `register_beta_tester` | Plafond réel 50 | `android`, `ios`, `computer` |
| Vimsongre | `beta_register` | Objectif 20, sans plafond automatique | `Android`, `iOS`, `Ordinateur` |

Le hub ne les uniformise pas. Les adaptateurs sont dans `src/projects.ts`.

## 4. Ce qui reste à faire dans le code

### Priorité P0 — rendre le service réellement exploitable

- ajouter les vrais identifiants D1 et KV dans `wrangler.jsonc` ;
- appliquer la migration D1 distante ;
- créer et configurer les vrais bots Telegram ;
- injecter les tokens et secrets avec Wrangler ;
- configurer `PUBLIC_BASE_URL` avec l’URL finale ;
- déployer le Worker ;
- enregistrer les webhooks ;
- tester chaque bot avec un vrai message Telegram.

### Priorité P1 — connecter les projets

- exposer ou choisir un endpoint sécurisé dans MonMenu, Sophiate et Vimsongre ;
- renseigner les URLs `PROJECT_MONMENU_BETA_API_URL`, `PROJECT_SOPHIATE_BETA_API_URL` et `PROJECT_VIMSONGRE_BETA_API_URL` ;
- injecter les trois tokens d’adaptateur ;
- implémenter côté adaptateur les payloads exacts de chaque RPC ;
- vérifier les statuts `closed`, `duplicate`, `quota` et `ok` ;
- ajouter des tests d’intégration contre un environnement de staging.

### Priorité P1 — administration

- dashboard réel des métriques par bot ;
- recherche des événements D1 ;
- affichage des erreurs et derniers messages ;
- activation/désactivation d’un bot ;
- vérification de chaque webhook ;
- gestion des projets et test des adaptateurs ;
- pagination et export des données administratives.

### Priorité P2 — fiabilité

- ajouter une file Cloudflare Queues pour les notifications longues ;
- ajouter des retries bornés et une dead-letter queue ;
- ajouter des tests unitaires et d’intégration ;
- ajouter des alertes sur taux d’erreur et latence ;
- ajouter une politique de rétention et purge des événements ;
- ajouter une authentification admin plus complète que le Bearer token unique.

## 5. Ce qui doit être fait manuellement

### Étape A — créer D1

Depuis le dossier du dépôt :

```bash
pnpm install
pnpm wrangler login
pnpm wrangler d1 create telegram-bots-hub
```

Copier le `database_id` retourné dans `wrangler.jsonc` à la place de :

```text
REPLACE_WITH_D1_DATABASE_ID
```

Puis appliquer la migration :

```bash
pnpm run db:migrate:remote
```

Vérifier :

```bash
pnpm wrangler d1 execute telegram-bots-hub --remote --command="SELECT id,name,logic FROM bot_instances"
```

### Étape B — créer KV

```bash
pnpm wrangler kv namespace create BOT_KV
```

Copier l’identifiant retourné dans `wrangler.jsonc` à la place de :

```text
REPLACE_WITH_KV_NAMESPACE_ID
```

### Étape C — créer les bots Telegram

Dans BotFather, créer un bot séparé pour chaque logique :

1. ouvrir `@BotFather` ;
2. exécuter `/newbot` ;
3. donner un nom et un username distincts ;
4. conserver le token dans un gestionnaire de secrets ;
5. générer un secret webhook fort de 32 octets ou plus ;
6. répéter pour chaque bot supplémentaire.

Ne jamais mettre les tokens dans Git, une issue ou un message public.

### Étape D — injecter les secrets

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

Pour un bot dont l’identifiant est `support-client`, les noms deviennent :

```text
TELEGRAM_BOT_TOKEN_SUPPORT_CLIENT
TELEGRAM_WEBHOOK_SECRET_SUPPORT_CLIENT
```

### Étape E — configurer les variables non secrètes

Remplacer dans `wrangler.jsonc` :

```json
"PUBLIC_BASE_URL": "https://telegram-bots-hub.<account>.workers.dev"
```

par l’URL réelle du Worker.

Pour ajouter des bots supplémentaires, définir `BOT_REGISTRY_JSON`, par exemple :

```json
[
  { "id": "support-client", "name": "Support client", "logic": "test", "enabled": true },
  { "id": "faq-restaurant", "name": "FAQ restaurant", "logic": "ai_chat", "enabled": true }
]
```

Les secrets associés doivent ensuite être ajoutés avec `wrangler secret put`.

### Étape F — déployer et enregistrer les webhooks

```bash
pnpm run typecheck
pnpm run deploy
curl -X POST "https://DOMAINE_DU_WORKER/admin/webhooks/register" \
  -H "Authorization: Bearer VALEUR_DE_ADMIN_TOKEN"
```

Vérifier chaque webhook :

```bash
curl "https://DOMAINE_DU_WORKER/admin/webhooks/registration" \
  -H "Authorization: Bearer VALEUR_DE_ADMIN_TOKEN"
```

### Étape G — test réel

Pour chaque bot :

1. envoyer `/start` dans Telegram ;
2. vérifier la réponse ;
3. vérifier l’événement dans D1 ;
4. vérifier le compteur de métriques ;
5. tester un callback inline pour `test-bot` ;
6. envoyer une question au bot IA ;
7. vérifier que le deuxième message utilise la mémoire courte ;
8. envoyer rapidement plusieurs messages pour vérifier le rate limiting ;
9. consulter les logs Cloudflare ;
10. tester un webhook avec un mauvais secret et vérifier le `401`.

## 6. Idées d’amélioration futures par bot

### Bot inscriptions bêta

- formulaire conversationnel étape par étape ;
- validation email et téléphone ;
- anti-doublon avant appel projet ;
- confirmation bilingue français/anglais ;
- choix du projet à tester ;
- statut de l’inscription via `/statut` ;
- notification Telegram à l’administrateur ;
- export et recherche des inscrits ;
- synchronisation contrôlée avec les trois projets.

### Assistant IA

- FAQ propre à chaque projet ;
- prompt système par bot ;
- quotas par utilisateur et par projet ;
- historique résumé plutôt que simple mémoire courte ;
- commandes `/reset`, `/help` et `/privacy` ;
- détection de sujets sensibles et transfert humain ;
- outils limités pour consulter des informations autorisées ;
- évaluation automatique de la qualité des réponses ;
- cache des questions fréquentes dans KV.

### Bot de test

- rapport automatique de santé ;
- test de latence Telegram ;
- inspection de la version du Worker ;
- boutons de test pour D1 et KV ;
- génération d’un identifiant de corrélation ;
- validation du secret webhook ;
- résumé d’incidents pour l’administrateur.

### Bots futurs possibles

- bot support client ;
- bot FAQ restaurant ;
- bot suivi de commande ;
- bot notification administrateur ;
- bot collecte de feedback ;
- bot modération ;
- bot onboarding ;
- bot relance marketing avec consentement ;
- bot synchronisation opérationnelle ;
- bot analytics et rapports quotidiens.

Chaque futur bot doit rester isolé dans son propre module, avec :

- son identifiant ;
- sa logique métier ;
- son contrat d’état ;
- ses commandes ;
- ses limites ;
- ses secrets ;
- ses tests.

## 7. Critères de passage en production

Le hub pourra être considéré comme prêt lorsque les points suivants seront vrais :

- [ ] D1 et KV réels configurés ;
- [ ] migration distante appliquée ;
- [ ] secrets configurés dans Cloudflare ;
- [ ] trois bots Telegram testés ;
- [ ] tests de mauvais secret et rate limit réussis ;
- [ ] monitoring et logs vérifiés ;
- [ ] adaptateurs projets testés sur staging ;
- [ ] tests de non-régression automatisés ;
- [ ] dashboard admin sécurisé ;
- [ ] procédure de restauration documentée ;
- [ ] aucun secret dans Git ;
- [ ] validation métier finale effectuée.
