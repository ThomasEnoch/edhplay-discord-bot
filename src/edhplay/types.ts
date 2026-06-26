// Shapes observed from the live EDH Play backend (api.edhplay.com) via dev tools.
// The API is undocumented and may change — treat these as best-effort.

export type GameFormat =
  | "commander"
  | "freecommander"
  | "casual"
  | string; // keep open: the backend accepts a string

export interface CreateRoomInput {
  name: string;            // required
  format: GameFormat;      // required
  is_public?: boolean;     // defaults to true server-side
  description?: string | null;
  max_players?: number;    // observed default 4
  spectators_enabled?: boolean;
  max_spectators?: number;
  bracket?: number | null; // WotC Commander bracket 1-5, if/when supported
  communication_preference?: string | null;
  languages?: string[];
  password?: string | null;
}

export interface Room {
  id: string;
  name: string;
  format: GameFormat;
  is_public: boolean;
  description: string | null;
  max_players: number;
  spectators_enabled: boolean;
  max_spectators: number;
  bracket: number | null;
  communication_preference: string | null;
  languages: string[];
  created_at: string;
  is_owner: boolean;
  active_players_count: number;
  spectator_count: number;
  can_spectate: boolean;
  phase: "lobby" | string;
  player_has_submitted_deck: boolean;
  player_is_in_room: boolean;
}

export interface CreateRoomResponse {
  success: boolean;
  room: Room;
  reason: string | null;
}

export interface RoomsList {
  user_rooms: Room[];
  public_rooms: Room[];
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  // epoch ms when the access token expires (decoded from the JWT `exp` claim)
  expiresAt: number;
}
