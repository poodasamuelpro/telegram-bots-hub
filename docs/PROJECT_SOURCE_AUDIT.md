# Audit des sources bêta
Lecture seule des migrations et handlers des dépôts sources; aucune modification de ces dépôts. Le hub utilise les clés `service_role` par projet et n’ajoute aucune table ni migration D1.
MonMenu — tables `beta_testers` et `beta_settings`; `device`, `extra` JSONB (aucun champ métier extra), réglages `maximum_testers` et `registrations_open`.
MonMenu — RPC `beta_get_overview`, `beta_register_tester`, `beta_set_open`; `maximum_testers` est un objectif informatif, jamais un plafond d’inscription.
MonMenu — appareils `android`, `ios`, `ordinateur`; unicité e-mail/WhatsApp, RLS et accès anon/authenticated révoqués.
Sophiate — tables `beta_testers` et `beta_settings`; extra `use_case`, cible `max_testers`, état `is_open`.
Sophiate — RPC `get_beta_overview`, `register_beta_tester`, `list_beta_testers`, `set_beta_collection_open`; `max_testers` est un plafond dur à l’inscription.
Sophiate — appareils `android`, `ios`, `computer`; unicité e-mail/WhatsApp, RLS et fonctions réservées au `service_role`.
Vimsongre — tables `beta_testers`, `beta_settings`, `beta_rate_limits`; extra `test_target`, cible `recruitment_goal`, état `is_open`.
Vimsongre — RPC `beta_overview`, `beta_register`, `beta_set_open`, `beta_rate_limit`; le goal est informatif, seul `is_open` bloque l’inscription.
Vimsongre — appareils `Android`, `iOS`, `Ordinateur`; route existante lit les mêmes colonnes, consentement horodaté et contrôle de débit côté projet.
Le hub conserve ces différences; l’action « quota » ajuste l’objectif MonMenu/Vimsongre ou le plafond Sophiate, après confirmation et avec minimum = inscrits, maximum = 500.
