// Button custom_id scheme: "pod:<action>:<podId>". Encoding the pod id keeps the
// button handlers stateless and survives the 3s interaction window.
// Kept dependency-free so it can be unit-tested without discord.js.

export const podCustomId = (action: string, podId: string) => `pod:${action}:${podId}`;

export function parsePodCustomId(
  customId: string,
): { action: string; podId: string } | null {
  const m = /^pod:([a-z]+):([a-z0-9-]+)$/.exec(customId);
  return m ? { action: m[1], podId: m[2] } : null;
}
