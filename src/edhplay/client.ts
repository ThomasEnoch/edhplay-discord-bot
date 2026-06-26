import { config } from "../config.js";
import { tokenStore, jwtExpiryMs } from "../store/tokenStore.js";
import type {
  CreateRoomInput,
  CreateRoomResponse,
  Room,
  RoomsList,
  StoredTokens,
} from "./types.js";

export class EdhPlayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "EdhPlayError";
  }
}

/** Thrown when a Discord user has not linked an EDH Play account yet. */
export class NotLinkedError extends Error {
  constructor() {
    super("This Discord user has not linked an EDH Play account.");
    this.name = "NotLinkedError";
  }
}

const api = (path: string): string => `${config.edhplayApiBase}${path}`;

/**
 * Returns a valid access token for a Discord user, refreshing it first if it is
 * within 60s of expiry. Throws NotLinkedError if the user has never linked.
 *
 * Verified live: POST /api/v1/auth/refresh with { refresh_token } returns
 * { access_token, refresh_token, token_type }.
 */
export async function getValidAccessToken(discordUserId: string): Promise<string> {
  const tokens = await tokenStore.get(discordUserId);
  if (!tokens) throw new NotLinkedError();

  if (Date.now() < tokens.expiresAt - 60_000) {
    return tokens.accessToken;
  }

  const res = await fetch(api("/api/v1/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refreshToken }),
  });

  if (!res.ok) {
    await tokenStore.delete(discordUserId);
    throw new NotLinkedError();
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
  };
  const refreshed: StoredTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: jwtExpiryMs(data.access_token),
  };
  await tokenStore.set(discordUserId, refreshed);
  return refreshed.accessToken;
}

async function authedFetch(
  discordUserId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getValidAccessToken(discordUserId);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(api(path), { ...init, headers });
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new EdhPlayError(`EDH Play API ${res.status}`, res.status, body);
  }
  return body as T;
}

export const edhplay = {
  /** Create a room. Only `name` and `format` are required by the backend. */
  async createRoom(discordUserId: string, input: CreateRoomInput): Promise<Room> {
    const res = await authedFetch(discordUserId, "/api/v1/rooms", {
      method: "POST",
      body: JSON.stringify(input),
    });
    const data = await parseOrThrow<CreateRoomResponse>(res);
    if (!data?.room) {
      // 200 OK but no room (e.g. the account isn't allowed to host yet).
      // Surface the server's reason instead of letting `data.room.id` throw.
      throw new EdhPlayError(
        data?.reason
          ? `EDH Play declined the room: ${data.reason}`
          : "EDH Play returned no room (success was false).",
        res.status,
        data,
      );
    }
    return data.room;
  },

  async getRoom(discordUserId: string, roomId: string): Promise<Room> {
    const res = await authedFetch(discordUserId, `/api/v1/rooms/${roomId}`);
    return parseOrThrow<Room>(res);
  },

  async deleteRoom(discordUserId: string, roomId: string): Promise<void> {
    const res = await authedFetch(discordUserId, `/api/v1/rooms/${roomId}`, {
      method: "DELETE",
    });
    await parseOrThrow<void>(res);
  },

  async listRooms(
    discordUserId: string,
    opts: { skip?: number; limit?: number } = {},
  ): Promise<RoomsList> {
    const params = new URLSearchParams({
      skip: String(opts.skip ?? 0),
      limit: String(opts.limit ?? 12),
      view: "grouped",
    });
    const res = await authedFetch(discordUserId, `/api/v1/rooms?${params}`);
    return parseOrThrow<RoomsList>(res);
  },

  /** Public web URL a player opens to enter a room. (Verified live route.) */
  roomUrl(roomId: string): string {
    return `${config.edhplayWebBase}/games/${roomId}/play`;
  },

  /** Spectator URL for a room. (Verified live route.) */
  spectateUrl(roomId: string): string {
    return `${config.edhplayWebBase}/games/${roomId}/spectate`;
  },
};
