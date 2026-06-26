import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import type { Pod } from "./pod.js";
import { edhplay } from "../edhplay/client.js";
import { config } from "../config.js";
import { podCustomId, parsePodCustomId } from "./ids.js";

export { podCustomId, parsePodCustomId };

function ts(epochMs: number, style: "F" | "R"): string {
  return `<t:${Math.floor(epochMs / 1000)}:${style}>`;
}

function seatLine(userId: string, isHost: boolean): string {
  return `\u{1F7E2} <@${userId}>${isHost ? " · host" : ""}`;
}

function podTags(pod: Pod): string {
  const o = pod.opts;
  const tags: string[] = [];
  if (o.bracket) tags.push(`Bracket ${o.bracket}`);
  tags.push(o.format);
  tags.push(o.voice ? "Voice" : "Chat only");
  if (o.proxiesOk) tags.push("Proxies OK");
  for (const r of o.restrictions ?? []) tags.push(r);
  return tags.join(" · ");
}

export function buildPodEmbed(pod: Pod): EmbedBuilder {
  const o = pod.opts;
  const filled = pod.seats.length;
  const open = o.maxPlayers - filled;

  const seated =
    pod.seats.map((id, i) => seatLine(id, i === 0)).join("\n") +
    (open > 0 ? `\n\u{26AA} ${open} open seat${open === 1 ? "" : "s"}` : "");

  const color =
    pod.status === "launched"
      ? 0x639922
      : pod.status === "cancelled"
        ? 0x6b7280
        : 0x534ab7;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(pod.status === "cancelled" ? `${o.title} (cancelled)` : o.title)
    .setDescription(o.description?.trim() ? o.description : null)
    .addFields(
      {
        name: "When",
        value: pod.isInstant
          ? "**Starting now**"
          : `${ts(o.scheduledAt!, "F")} (${ts(o.scheduledAt!, "R")})`,
        inline: true,
      },
      { name: "Seats", value: `**${filled}/${o.maxPlayers}**`, inline: true },
      { name: "​", value: "​", inline: true },
      { name: "Table", value: podTags(pod), inline: false },
      { name: "Seated", value: seated, inline: false },
    )
    .setFooter({
      text:
        pod.status === "cancelled"
          ? "This pod was cancelled."
          : pod.status === "launched"
            ? pod.roomId
              ? "Pod launched — room created on EDH Play."
              : "Pod launched — set up your game on EDH Play."
            : pod.isInstant
              ? "Launches an EDH Play room when the pod fills."
              : "Launches automatically at start time. Reminder 15 min before.",
    });

  if (pod.waitlist.length) {
    embed.addFields({
      name: "Waitlist",
      value: pod.waitlist.map((id) => `<@${id}>`).join(", "),
      inline: false,
    });
  }

  if (pod.roomId) {
    embed.addFields({
      name: "Game room",
      value: `[Join on EDH Play](${edhplay.roomUrl(pod.roomId)})`,
      inline: false,
    });
  } else if (pod.status === "launched") {
    embed.addFields({
      name: "Game room",
      value: `No room was auto-created. Set one up at [EDH Play](${config.edhplayWebBase}) — or the host can \`/link\` for one-click rooms.`,
      inline: false,
    });
  }

  return embed;
}

export function buildPodButtons(pod: Pod): ActionRowBuilder<ButtonBuilder>[] {
  if (pod.status === "cancelled") return [];

  if (pod.status === "launched") {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel(pod.roomId ? "Open game room" : "Go to EDH Play")
        .setStyle(ButtonStyle.Link)
        .setURL(pod.roomId ? edhplay.roomUrl(pod.roomId) : config.edhplayWebBase),
      new ButtonBuilder()
        .setCustomId(podCustomId("leave", pod.id))
        .setLabel("Leave")
        .setStyle(ButtonStyle.Secondary),
    );
    return [row];
  }

  const primary = new ButtonBuilder()
    .setCustomId(podCustomId(pod.isFull ? "waitlist" : "seat", pod.id))
    .setLabel(pod.isFull ? "Join waitlist" : "Take a seat")
    .setStyle(pod.isFull ? ButtonStyle.Secondary : ButtonStyle.Primary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    primary,
    new ButtonBuilder()
      .setCustomId(podCustomId("leave", pod.id))
      .setLabel("Leave")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(podCustomId("launch", pod.id))
      .setLabel("Launch now")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(podCustomId("cancel", pod.id))
      .setLabel("Cancel pod")
      .setStyle(ButtonStyle.Danger),
  );
  return [row];
}
