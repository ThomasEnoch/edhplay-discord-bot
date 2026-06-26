import { type Client, type Message } from "discord.js";
import { Pod } from "./pod.js";
import { buildPodEmbed, buildPodButtons } from "./embed.js";
import { podStore } from "../store/podStore.js";
import { edhplay, NotLinkedError } from "../edhplay/client.js";
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

/**
 * Launch a pod: create the EDH Play room using the HOST's linked account, spin
 * up a voice channel, mark the pod launched, and refresh the message. Returns
 * the room URL.
 */
export async function launchPod(client: Client, pod: Pod): Promise<string> {
  if (pod.status === "launched" && pod.roomId) return edhplay.roomUrl(pod.roomId);

  let room;
  try {
    room = await edhplay.createRoom(pod.opts.hostId, {
      name: pod.opts.title,
      format: pod.opts.format,
      is_public: true,
      max_players: pod.opts.maxPlayers,
      bracket: pod.opts.bracket ?? null,
      communication_preference: pod.opts.voice ? "voice" : "chat",
      description: pod.opts.description ?? null,
    });
  } catch (err) {
    if (err instanceof NotLinkedError) {
      throw new LaunchError(
        "The pod host hasn't linked an EDH Play account. Run `/link` first.",
      );
    }
    throw new LaunchError(`Couldn't create the EDH Play room: ${(err as Error).message}`);
  }

  pod.roomId = room.id;
  pod.status = "launched";
  pod.launchedAt = Date.now();
  await createPodVoiceChannel(client, pod).catch(() => null);
  podStore.save(pod);
  await refreshPod(client, pod);
  return edhplay.roomUrl(room.id);
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
