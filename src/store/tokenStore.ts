import { db } from "./db.js";
import type { StoredTokens } from "../edhplay/types.js";

// Maps a Discord user ID -> their EDH Play tokens, persisted in SQLite.
//
// The methods stay async to preserve the call sites, even though better-sqlite3
// is synchronous. SECURITY: these tokens grant full access to the user's EDH
// Play account — encrypt them at rest before any real deployment.

interface TokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

const getStmt = db.prepare(
  "SELECT access_token, refresh_token, expires_at FROM tokens WHERE discord_user_id = ?",
);
const setStmt = db.prepare(
  `INSERT INTO tokens (discord_user_id, access_token, refresh_token, expires_at)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(discord_user_id) DO UPDATE SET
     access_token  = excluded.access_token,
     refresh_token = excluded.refresh_token,
     expires_at    = excluded.expires_at`,
);
const deleteStmt = db.prepare("DELETE FROM tokens WHERE discord_user_id = ?");

export class TokenStore {
  async get(discordUserId: string): Promise<StoredTokens | undefined> {
    const row = getStmt.get(discordUserId) as TokenRow | undefined;
    if (!row) return undefined;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
    };
  }

  async set(discordUserId: string, tokens: StoredTokens): Promise<void> {
    setStmt.run(discordUserId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
  }

  async delete(discordUserId: string): Promise<void> {
    deleteStmt.run(discordUserId);
  }

  async isLinked(discordUserId: string): Promise<boolean> {
    return Boolean(await this.get(discordUserId));
  }
}

export const tokenStore = new TokenStore();

/** Decode the `exp` claim (epoch seconds) from a JWT without verifying it. */
export function jwtExpiryMs(jwt: string): number {
  try {
    const payload = jwt.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof json.exp === "number") return json.exp * 1000;
  } catch {
    /* ignore */
  }
  // Fallback: assume 30 minutes if we cannot parse.
  return Date.now() + 30 * 60 * 1000;
}
