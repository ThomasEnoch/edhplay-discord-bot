import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";

// Single SQLite database backing both the pod store and the token store. WAL
// mode keeps reads from blocking the bot's write-through on every interaction.

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS pods (
    id         TEXT PRIMARY KEY,
    message_id TEXT,
    data       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pods_message ON pods(message_id);

  CREATE TABLE IF NOT EXISTS tokens (
    discord_user_id TEXT PRIMARY KEY,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    expires_at      INTEGER NOT NULL
  );
`);
