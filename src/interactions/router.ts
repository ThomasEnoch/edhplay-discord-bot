import { MessageFlags, type Interaction } from "discord.js";
import { commandMap, handleLinkModal, buildLinkModal } from "../commands/index.js";
import { parsePodCustomId } from "../pods/embed.js";
import { podStore } from "../store/podStore.js";
import {
  refreshPod,
  launchPod,
  cancelPod,
  startRematch,
  LaunchError,
} from "../pods/manager.js";

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = commandMap.get(interaction.commandName);
      if (cmd) await cmd.execute(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "link:submit") {
      const field1 = interaction.fields.getTextInputValue("access_token");
      const field2 = interaction.fields.getTextInputValue("refresh_token");
      try {
        await handleLinkModal(field1, field2, interaction.user.id);
      } catch {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content:
            "Couldn't read your tokens. Paste the bookmarklet output into the first box, or fill in both token fields manually.",
        });
        return;
      }
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "EDH Play account linked. You can now host pods with `/lfg` or `/schedule`.",
      });
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === "link:open") {
        await interaction.showModal(buildLinkModal());
        return;
      }

      const parsed = parsePodCustomId(interaction.customId);
      if (!parsed) return;
      const pod = podStore.get(parsed.podId);
      if (!pod) {
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: "This pod is no longer active.",
        });
        return;
      }

      const userId = interaction.user.id;

      if (parsed.action === "seat" || parsed.action === "waitlist") {
        const result = pod.join(userId);
        if (result !== "already-in") podStore.save(pod);
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content:
            result === "already-in"
              ? "You're already in this pod."
              : result === "seated"
                ? `You're seated (${pod.seats.length}/${pod.opts.maxPlayers}).`
                : "Pod is full — you've been added to the waitlist. I'll ping you if a seat opens.",
        });
        await refreshPod(interaction.client, pod);

        // Auto-launch an instant pod the moment it fills.
        if (pod.isInstant && pod.isFull && pod.status === "open") {
          await launchPod(interaction.client, pod).catch(() => undefined);
        }
        return;
      }

      if (parsed.action === "leave") {
        const { left, promoted } = pod.leave(userId);
        if (left) podStore.save(pod);
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: left ? "You've left the pod." : "You weren't in this pod.",
        });
        await refreshPod(interaction.client, pod);
        if (promoted) {
          await interaction.followUp({
            content: `<@${promoted}> a seat opened — you're in! (${pod.seats.length}/${pod.opts.maxPlayers})`,
          });
        }
        return;
      }

      if (parsed.action === "launch") {
        if (userId !== pod.opts.hostId) {
          await interaction.reply({
            flags: MessageFlags.Ephemeral,
            content: "Only the pod host can launch the game early.",
          });
          return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          const { url } = await launchPod(interaction.client, pod);
          await interaction.editReply({
            content: url
              ? `Game room created: ${url}`
              : "Pod launched! I couldn't auto-create an EDH Play room — link your account with `/link` to enable that. For now, set up the game on EDH Play.",
          });
        } catch (err) {
          await interaction.editReply({
            content:
              err instanceof LaunchError ? err.message : "Failed to launch the pod.",
          });
        }
        return;
      }

      if (parsed.action === "cancel") {
        if (userId !== pod.opts.hostId) {
          await interaction.reply({
            flags: MessageFlags.Ephemeral,
            content: "Only the pod host can cancel the pod.",
          });
          return;
        }
        if (pod.status !== "open") {
          await interaction.reply({
            flags: MessageFlags.Ephemeral,
            content: "This pod has already started and can't be cancelled.",
          });
          return;
        }
        const notify = await cancelPod(interaction.client, pod);
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: "Pod cancelled.",
        });
        const others = notify.filter((id) => id !== pod.opts.hostId);
        if (others.length) {
          await interaction.followUp({
            content: `${others.map((id) => `<@${id}>`).join(" ")} — **${pod.opts.title}** was cancelled by the host.`,
          });
        }
        return;
      }

      if (parsed.action === "again") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
          const { pod: next, created, launchError } = await startRematch(
            interaction.client,
            pod,
          );
          const link = next.messageId
            ? ` https://discord.com/channels/${next.opts.guildId}/${next.opts.channelId}/${next.messageId}`
            : "";
          const base = created
            ? `🔁 One more game!${link}`
            : `One more game is already going.${link}`;
          await interaction.editReply({
            content: launchError ? `${base}\n(Heads up: ${launchError})` : base,
          });
        } catch {
          await interaction.editReply({ content: "Couldn't start another game." });
        }
        return;
      }
    }
  } catch (err) {
    console.error("Interaction error:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ flags: MessageFlags.Ephemeral, content: "Something went wrong." })
        .catch(() => undefined);
    }
  }
}
