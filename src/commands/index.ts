import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type ModalActionRowComponentBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { Pod } from "../pods/pod.js";
import { createAndPostPod } from "../pods/manager.js";
import { tokenStore, jwtExpiryMs } from "../store/tokenStore.js";
import { podStore } from "../store/podStore.js";
import { edhplay, NotLinkedError } from "../edhplay/client.js";

const FORMAT_CHOICES = [
  { name: "Commander", value: "commander" },
  { name: "Free Commander", value: "freecommander" },
  { name: "Casual", value: "casual" },
];

type Handler = (i: ChatInputCommandInteraction) => Promise<void>;

interface Command {
  data: ReturnType<SlashCommandBuilder["toJSON"]>;
  execute: Handler;
}

// Shared option set for pod-creating commands. Typed as the options-only
// builder so it accepts a fresh SlashCommandBuilder *and* one already narrowed
// by a prior .addIntegerOption() (as in /schedule).
function podOptions(b: SlashCommandOptionsOnlyBuilder) {
  return b
    .addStringOption((o) =>
      o.setName("title").setDescription("Name for the table").setMaxLength(60),
    )
    .addStringOption((o) =>
      o
        .setName("format")
        .setDescription("Game format")
        .addChoices(...FORMAT_CHOICES),
    )
    .addIntegerOption((o) =>
      o
        .setName("bracket")
        .setDescription("WotC Commander bracket (1-5)")
        .setMinValue(1)
        .setMaxValue(5),
    )
    .addIntegerOption((o) =>
      o
        .setName("players")
        .setDescription("Seats at the table (2-6)")
        .setMinValue(2)
        .setMaxValue(6),
    )
    .addBooleanOption((o) =>
      o.setName("voice").setDescription("Create a voice channel for the pod"),
    )
    .addBooleanOption((o) =>
      o.setName("proxies").setDescription("Proxies allowed"),
    );
}

function readPodOptions(i: ChatInputCommandInteraction, scheduledAt: number | null): Pod {
  return new Pod({
    guildId: i.guildId!,
    channelId: i.channelId,
    hostId: i.user.id,
    title:
      i.options.getString("title") ??
      `${i.user.displayName ?? i.user.username}'s pod`,
    format: i.options.getString("format") ?? "commander",
    bracket: i.options.getInteger("bracket"),
    maxPlayers: i.options.getInteger("players") ?? 4,
    voice: i.options.getBoolean("voice") ?? true,
    proxiesOk: i.options.getBoolean("proxies") ?? false,
    scheduledAt,
  });
}

async function ensureLinked(i: ChatInputCommandInteraction): Promise<boolean> {
  if (await tokenStore.isLinked(i.user.id)) return true;
  await i.reply({
    flags: MessageFlags.Ephemeral,
    content:
      "You need to link your EDH Play account first so I can create rooms as you. Run `/link`.",
  });
  return false;
}

const commands: Command[] = [
  {
    data: (() => {
      const b = new SlashCommandBuilder()
        .setName("lfg")
        .setDescription("Open a Commander pod right now and look for players");
      podOptions(b);
      return b.toJSON();
    })(),
    execute: async (i) => {
      if (!i.guildId) return;
      if (!(await ensureLinked(i))) return;
      const pod = readPodOptions(i, null);
      await createAndPostPod(i.client, pod);
      await i.reply({
        flags: MessageFlags.Ephemeral,
        content: `Pod opened. You're seated as host (1/${pod.opts.maxPlayers}).`,
      });
    },
  },
  {
    data: (() => {
      const b = new SlashCommandBuilder()
        .setName("schedule")
        .setDescription("Schedule a Commander pod for later")
        .addIntegerOption((o) =>
          o
            .setName("minutes_from_now")
            .setDescription("Start time, in minutes from now")
            .setMinValue(5)
            .setMaxValue(60 * 24 * 7)
            .setRequired(true),
        );
      podOptions(b);
      return b.toJSON();
    })(),
    execute: async (i) => {
      if (!i.guildId) return;
      if (!(await ensureLinked(i))) return;
      const minutes = i.options.getInteger("minutes_from_now", true);
      const scheduledAt = Date.now() + minutes * 60_000;
      const pod = readPodOptions(i, scheduledAt);
      await createAndPostPod(i.client, pod);
      await i.reply({
        flags: MessageFlags.Ephemeral,
        content: `Pod scheduled for <t:${Math.floor(scheduledAt / 1000)}:F>. It'll launch automatically.`,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("pods")
      .setDescription("List open pods in this server and public EDH Play rooms")
      .toJSON(),
    execute: async (i) => {
      const local = podStore
        .all()
        .filter((p) => p.opts.guildId === i.guildId && p.status === "open");

      const lines = local.length
        ? local.map(
            (p) =>
              `• **${p.opts.title}** — ${p.seats.length}/${p.opts.maxPlayers} · ` +
              (p.isInstant ? "now" : `<t:${Math.floor(p.opts.scheduledAt! / 1000)}:R>`),
          )
        : ["No open pods in this server. Start one with `/lfg` or `/schedule`."];

      const embed = new EmbedBuilder()
        .setTitle("Open pods")
        .setColor(0x534ab7)
        .setDescription(lines.join("\n"));

      // Best-effort: also show a few public EDH Play rooms (needs a linked acct).
      try {
        const rooms = await edhplay.listRooms(i.user.id, { limit: 5 });
        if (rooms.public_rooms.length) {
          embed.addFields({
            name: "Public EDH Play rooms",
            value: rooms.public_rooms
              .map(
                (r) =>
                  `• ${r.name} (${r.format}) — ${r.active_players_count}/${r.max_players}`,
              )
              .join("\n"),
          });
        }
      } catch (err) {
        if (!(err instanceof NotLinkedError)) {
          /* ignore transient API errors in the listing */
        }
      }

      await i.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("link")
      .setDescription("Link your EDH Play account so the bot can create rooms as you")
      .toJSON(),
    execute: async (i) => {
      const modal = new ModalBuilder()
        .setCustomId("link:submit")
        .setTitle("Link EDH Play account");

      const access = new TextInputBuilder()
        .setCustomId("access_token")
        .setLabel("access_token")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Paste the access_token from edhplay.com localStorage")
        .setRequired(true);

      const refresh = new TextInputBuilder()
        .setCustomId("refresh_token")
        .setLabel("refresh_token")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Paste the refresh_token (so the bot can stay logged in)")
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(access),
        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(refresh),
      );
      await i.showModal(modal);
    },
  },
];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
export const commandData = commands.map((c) => c.data);

// Handles the /link modal submission. Wired from the interaction router.
export async function handleLinkModal(accessToken: string, refreshToken: string, userId: string) {
  await tokenStore.set(userId, {
    accessToken: accessToken.trim(),
    refreshToken: refreshToken.trim(),
    expiresAt: jwtExpiryMs(accessToken.trim()),
  });
}

export { jwtExpiryMs };
