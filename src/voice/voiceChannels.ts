import { ChannelType, type Client, type Guild } from "discord.js";
import type { Pod } from "../pods/pod.js";

// Creates a temporary voice channel for a pod and returns its id. The channel
// is created next to the text channel the pod was posted in. We do NOT lock it
// down by default (Commander pods are usually open), but you can pass
// permissionOverwrites if you want seated-players-only voice.

export async function createPodVoiceChannel(
  client: Client,
  pod: Pod,
): Promise<string | null> {
  if (!pod.opts.voice) return null;
  const guild = client.guilds.cache.get(pod.opts.guildId);
  if (!guild) return null;

  const textChannel = guild.channels.cache.get(pod.opts.channelId);
  const parent =
    textChannel && "parentId" in textChannel ? textChannel.parentId : null;

  const channel = await guild.channels.create({
    name: `🎴 ${pod.opts.title}`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: parent ?? undefined,
    userLimit: pod.opts.maxPlayers + 2, // players + a couple spectators
    reason: `Temp voice channel for pod ${pod.id}`,
  });

  pod.voiceChannelId = channel.id;
  return channel.id;
}

/**
 * True if the pod has a voice channel and nobody is currently connected to it.
 * Relies on the GuildVoiceStates intent (set in index.ts) to populate members.
 */
export function isPodVoiceChannelEmpty(client: Client, pod: Pod): boolean {
  if (!pod.voiceChannelId) return false;
  const guild = client.guilds.cache.get(pod.opts.guildId);
  const channel = guild?.channels.cache.get(pod.voiceChannelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) return false;
  return channel.members.size === 0;
}

export async function cleanupPodVoiceChannel(
  client: Client,
  pod: Pod,
): Promise<void> {
  if (!pod.voiceChannelId) return;
  const guild: Guild | undefined = client.guilds.cache.get(pod.opts.guildId);
  const channel = guild?.channels.cache.get(pod.voiceChannelId);
  if (channel) {
    await channel.delete(`Pod ${pod.id} ended`).catch(() => undefined);
  }
  pod.voiceChannelId = null;
}
