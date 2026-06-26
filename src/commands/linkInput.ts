export interface LinkTokens {
  access: string;
  refresh: string;
}

// Kept dependency-free (no discord.js / db) so it can be unit-tested directly.

/**
 * Parse the /link modal inputs. The first field accepts either a raw
 * access_token or the JSON blob the bookmarklet copies
 * (`{ "access_token": "...", "refresh_token": "..." }`); the second field is the
 * refresh_token, used only when a blob didn't already supply it. Throws if
 * either token ends up missing.
 */
export function parseLinkInput(field1: string, field2: string): LinkTokens {
  let access = field1.trim();
  let refresh = field2.trim();

  try {
    const blob = JSON.parse(field1) as Record<string, unknown>;
    if (blob && typeof blob === "object") {
      const a = blob.access_token ?? blob.accessToken;
      const r = blob.refresh_token ?? blob.refreshToken;
      if (typeof a === "string") access = a.trim();
      if (typeof r === "string") refresh = r.trim();
    }
  } catch {
    /* field1 isn't JSON — treat it as a raw access token */
  }

  if (!access) throw new Error("No access token provided.");
  if (!refresh) throw new Error("No refresh token provided.");
  return { access, refresh };
}
