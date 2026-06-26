import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type ModalActionRowComponentBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { Pod } from "../pods/pod.js";
import { createAndPostPod } from "../pods/manager.js";
import { tokenStore, jwtExpiryMs, SERVICE_TOKEN_KEY } from "../store/tokenStore.js";
import { podStore } from "../store/podStore.js";
import { edhplay, NotLinkedError } from "../edhplay/client.js";
import { parseLinkInput } from "./linkInput.js";

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

/** A gentle nudge appended to pod-creation replies when no room can be created. */
async function linkTip(userId: string): Promise<string> {
  // Linked personally, or a shared service account exists → rooms get created,
  // so there's nothing to nudge about.
  if (await tokenStore.isLinked(userId)) return "";
  if (await tokenStore.isLinked(SERVICE_TOKEN_KEY)) return "";
  return "\nTip: run `/link` to auto-create the EDH Play room when the pod launches.";
}

// One-line bookmarklet: reads the EDH Play tokens from edhplay.com localStorage
// and copies them as the JSON blob the /link modal accepts.
const LINK_BOOKMARKLET =
  "javascript:(function(){try{var a=localStorage.getItem('access_token'),r=localStorage.getItem('refresh_token');if(!a||!r){alert('EDH Play tokens not found - log in on edhplay.com first.');return;}var b=JSON.stringify({access_token:a,refresh_token:r});var ok=function(){alert('EDH Play tokens copied. Paste into the bot /link box.');};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(b).then(ok,function(){window.prompt('Copy this, paste into /link:',b);});}else{window.prompt('Copy this, paste into /link:',b);}}catch(e){alert('Error: '+e.message);}})();";

/** The ephemeral how-to shown when someone runs /link. */
function buildLinkHelp(): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const description = [
    "Pods already create rooms under the shared bot account, so **you usually don't need this** — link only if you want rooms under *your own* EDH Play account.",
    "",
    "__Quickest — bookmarklet (one paste):__",
    "1. Create a browser bookmark and set its **URL** to:",
    "```\n" + LINK_BOOKMARKLET + "\n```",
    "2. On edhplay.com (logged in), click that bookmark — it copies your tokens.",
    "3. Hit **Enter tokens** below and paste into the first box.",
    "",
    "__Or by hand:__ edhplay.com → F12 → Application → Local Storage → copy `access_token` and `refresh_token`, then **Enter tokens** and paste both.",
  ].join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Link your EDH Play account")
    .setColor(0x534ab7)
    .setDescription(description);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("link:open")
      .setLabel("Enter tokens")
      .setStyle(ButtonStyle.Primary),
  );
  return { embed, row };
}

/** The paste modal, opened from the /link help message's button. */
export function buildLinkModal(): ModalBuilder {
  const access = new TextInputBuilder()
    .setCustomId("access_token")
    .setLabel("Bookmarklet output or access_token")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Paste the bookmarklet output here — or just your access_token")
    .setRequired(true);

  const refresh = new TextInputBuilder()
    .setCustomId("refresh_token")
    .setLabel("refresh_token (optional)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Leave blank if you pasted the bookmarklet output above")
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId("link:submit")
    .setTitle("Link EDH Play account")
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(access),
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(refresh),
    );
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
      const pod = readPodOptions(i, null);
      await createAndPostPod(i.client, pod);
      await i.reply({
        flags: MessageFlags.Ephemeral,
        content: `Pod opened. You're seated as host (1/${pod.opts.maxPlayers}).${await linkTip(i.user.id)}`,
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
      const minutes = i.options.getInteger("minutes_from_now", true);
      const scheduledAt = Date.now() + minutes * 60_000;
      const pod = readPodOptions(i, scheduledAt);
      await createAndPostPod(i.client, pod);
      await i.reply({
        flags: MessageFlags.Ephemeral,
        content: `Pod scheduled for <t:${Math.floor(scheduledAt / 1000)}:F>. It'll launch automatically.${await linkTip(i.user.id)}`,
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
      const { embed, row } = buildLinkHelp();
      await i.reply({ flags: MessageFlags.Ephemeral, embeds: [embed], components: [row] });
    },
  },
];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
export const commandData = commands.map((c) => c.data);

// Handles the /link modal submission. Wired from the interaction router.
// field1 may be a raw access_token or the bookmarklet's JSON blob; field2 is the
// refresh_token (optional when a blob supplies it). Throws on missing tokens.
export async function handleLinkModal(field1: string, field2: string, userId: string) {
  const { access, refresh } = parseLinkInput(field1, field2);
  await tokenStore.set(userId, {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: jwtExpiryMs(access),
  });
}

export { jwtExpiryMs };
