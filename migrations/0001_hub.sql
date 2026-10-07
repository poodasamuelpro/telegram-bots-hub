PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bot_instances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  logic TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  update_id INTEGER,
  telegram_user_id TEXT,
  chat_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bot_id) REFERENCES bot_instances(id)
);
CREATE INDEX IF NOT EXISTS idx_bot_events_bot_created ON bot_events(bot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversations (
  bot_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bot_id, chat_id),
  FOREIGN KEY (bot_id) REFERENCES bot_instances(id)
);

CREATE TABLE IF NOT EXISTS bot_metrics (
  bot_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  messages_received INTEGER NOT NULL DEFAULT 0,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, metric_date),
  FOREIGN KEY (bot_id) REFERENCES bot_instances(id)
);

INSERT OR IGNORE INTO bot_instances(id,name,description,logic) VALUES
 ('registration','Bot inscriptions','Collecte de données et confirmation de groupe','registration'),
 ('ai-chat','Assistant IA','Réponses conversationnelles avec mémoire courte','ai_chat'),
 ('test-bot','Bot de test','Diagnostic webhook, boutons et métriques','test');
