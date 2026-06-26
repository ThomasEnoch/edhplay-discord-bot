import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId: process.env.DISCORD_GUILD_ID || undefined,
  edhplayApiBase: process.env.EDHPLAY_API_BASE || "https://api.edhplay.com",
  edhplayWebBase: process.env.EDHPLAY_WEB_BASE || "https://edhplay.com",
  dbPath: process.env.DB_PATH || "./data/edhplay.db",
} as const;
