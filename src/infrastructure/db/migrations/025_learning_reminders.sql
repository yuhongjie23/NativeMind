CREATE TABLE IF NOT EXISTS learning_reminders (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL
);
-- @@split
CREATE TABLE IF NOT EXISTS learning_knowledge (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL
);
