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
  // Optional shared "service" EDH Play account. When set, the bot creates rooms
  // under it for hosts who haven't linked their own account — so friends never
  // have to link. Grab these once from edhplay.com localStorage (see README).
  edhplayServiceAccessToken: process.env.EDHPLAY_SERVICE_ACCESS_TOKEN || undefined,
  edhplayServiceRefreshToken: process.env.EDHPLAY_SERVICE_REFRESH_TOKEN || undefined,
} as const;
