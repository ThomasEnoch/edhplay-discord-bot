import { type Client, type Message } from "discord.js";
import { Pod } from "./pod.js";
import { buildPodEmbed, buildPodButtons } from "./embed.js";
import { podStore } from "../store/podStore.js";
import { edhplay, NotLinkedError } from "../edhplay/client.js";
import { tokenStore, SERVICE_TOKEN_KEY } from "../store/tokenStore.js";
import {
  createPodVoiceChannel,
  cleanupPodVoiceChannel,
  isPodVoiceChannelEmpty,
} from "../voice/voiceChannels.js";

async function fetchPodMessage(client: Client, pod: Pod): Promise<Message | null> {
  if (!pod.messageId) return null;
  const channel = await client.channels.fetch(pod.opts.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("messages" in channel)) return null;
  return channel.messages.fetch(pod.messageId).catch(() => null);
}

/** Post the initial pod message to its channel and register it. */
export async function postPod(client: Client, pod: Pod): Promise<Message | null> {
  const channel = await client.channels.fetch(pod.opts.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return null;

  const msg = await channel.send({
    content: pod.isInstant ? "**Looking for game** — pod open" : undefined,
    embeds: [buildPodEmbed(pod)],
    components: buildPodButtons(pod),
  });
  pod.messageId = msg.id;
  podStore.add(pod);
  return msg;
}

/** Re-render a pod's message after its state changed. */
export async function refreshPod(client: Client, pod: Pod): Promise<void> {
  const msg = await fetchPodMessage(client, pod);
  if (!msg) return;
  await msg.edit({
    embeds: [buildPodEmbed(pod)],
    components: buildPodButtons(pod),
  });
}

export class LaunchError extends Error {}

export interface LaunchResult {
  /** EDH Play room id, or null if the pod launched without an auto-created room. */
  roomId: string | null;
  /** Join URL for the room, or null when there is no room. */
  url: string | null;
}

/**
 * Launch a pod. If the host has linked EDH Play, create the room as them and
 * post a join link; otherwise launch the pod as a Discord-only event (no room).
 * Either way: spin up the voice channel, mark it launched, persist, and
 * re-render. Only a genuine EDH Play API failure throws (LaunchError).
 */
export async function launchPod(client: Client, pod: Pod): Promise<LaunchResult> {
  if (pod.status !== "launched") {
    // Whose EDH Play account creates the room: the host's own link if they have
    // one, else the shared service account, else nobody (roomless launch).
    const tokenUserId = (await tokenStore.isLinked(pod.opts.hostId))
      ? pod.opts.hostId
      : (await tokenStore.isLinked(SERVICE_TOKEN_KEY))
        ? SERVICE_TOKEN_KEY
        : null;

    let roomId: string | null = null;
    if (tokenUserId) {
      try {
        const room = await edhplay.createRoom(tokenUserId, {
          name: pod.opts.title,
          format: pod.opts.format,
          is_public: true,
          max_players: pod.opts.maxPlayers,
          bracket: pod.opts.bracket ?? null,
          communication_preference: pod.opts.voice ? "voice" : "chat",
          description: pod.opts.description ?? null,
        });
        roomId = room.id;
      } catch (err) {
        // Token expired and refresh failed: launch without a room. Anything else
        // is a real API failure and should surface to the caller.
        if (!(err instanceof NotLinkedError)) {
          throw new LaunchError(
            `Couldn't create the EDH Play room: ${(err as Error).message}`,
          );
        }
      }
    }

    pod.roomId = roomId;
    pod.status = "launched";
    pod.launchedAt = Date.now();
    await createPodVoiceChannel(client, pod).catch(() => null);
    podStore.save(pod);
    await refreshPod(client, pod);
  }

  return {
    roomId: pod.roomId,
    url: pod.roomId ? edhplay.roomUrl(pod.roomId) : null,
  };
}

/**
 * Cancel an open pod: mark it cancelled, tear down its voice channel, re-render
 * the message (greyed out, no buttons) and drop it from the store. Returns the
 * users who were in the pod so the caller can notify them.
 */
export async function cancelPod(client: Client, pod: Pod): Promise<string[]> {
  const notify = pod.cancel();
  await cleanupPodVoiceChannel(client, pod).catch(() => undefined);
  await refreshPod(client, pod);
  podStore.remove(pod.id);
  return notify;
}

/**
 * Start a "one more game": clone the finished pod (same settings + roster), post
 * it, and launch a fresh room. Idempotent — if this pod already spawned a next
 * game, returns that one instead of creating another.
 */
export async function startRematch(
  client: Client,
  pod: Pod,
): Promise<{ pod: Pod; created: boolean; launchError: string | null }> {
  const existing = pod.nextPodId ? podStore.get(pod.nextPodId) : undefined;
  if (existing) return { pod: existing, created: false, launchError: null };

  const next = pod.rematch();
  pod.nextPodId = next.id; // mark synchronously to guard against double-clicks
  podStore.add(next);
  podStore.save(pod);

  await postPod(client, next);

  let launchError: string | null = null;
  try {
    await launchPod(client, next);
  } catch (err) {
    launchError =
      err instanceof LaunchError ? err.message : "the room couldn't be created";
  }
  return { pod: next, created: true, launchError };
}

/** Create + post a pod in one call. */
export async function createAndPostPod(
  client: Client,
  pod: Pod,
): Promise<Pod> {
  await postPod(client, pod);
  return pod;
}

// Cleanup tuning. A Commander game runs ~1-3h; these give a table room to gather
// and break up without leaving stale voice channels or pod records behind.
const VOICE_EMPTY_GRACE_MS = 15 * 60 * 1000;
const LAUNCHED_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * Periodic cleanup of launched pods: delete the voice channel once it has sat
 * empty past a grace period, and forget the pod entirely once it ages out.
 * Cancelled pods are removed inline by cancelPod, so this only sweeps launched.
 */
export async function sweepLaunchedPods(client: Client, now: number): Promise<void> {
  for (const pod of podStore.all()) {
    if (pod.status !== "launched" || pod.launchedAt === null) continue;
    const age = now - pod.launchedAt;

    if (
      pod.voiceChannelId &&
      age > VOICE_EMPTY_GRACE_MS &&
      isPodVoiceChannelEmpty(client, pod)
    ) {
      await cleanupPodVoiceChannel(client, pod).catch(() => undefined);
      podStore.save(pod);
    }

    if (age > LAUNCHED_TTL_MS) {
      await cleanupPodVoiceChannel(client, pod).catch(() => undefined);
      podStore.remove(pod.id);
    }
  }
}
