import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { handleInteraction } from "./interactions/router.js";
import { podStore } from "./store/podStore.js";
import type { Pod } from "./pods/pod.js";
import {
  launchPod,
  cancelPod,
  sweepLaunchedPods,
  LaunchError,
} from "./pods/manager.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  podStore.load();
  console.log(`Rehydrated ${podStore.all().length} pod(s) from SQLite.`);
  startScheduler(client);
});

client.on(Events.InteractionCreate, handleInteraction);

// Polls scheduled pods (15-minute reminder + auto-launch) and sweeps finished
// pods. A real deployment would use a durable job queue instead of an in-process
// interval, but this keeps the MVP self-contained.
const REMINDER_LEAD_MS = 15 * 60 * 1000;
const MAX_AUTO_LAUNCH_ATTEMPTS = 3;

function startScheduler(client: Client): void {
  setInterval(() => void tick(client), 30_000).unref();
}

async function tick(client: Client): Promise<void> {
  const now = Date.now();
  for (const pod of podStore.all()) {
    if (pod.status === "open" && !pod.isInstant) {
      await driveScheduledPod(client, pod, now).catch((e) =>
        console.error("Scheduler error:", e),
      );
    }
  }
  await sweepLaunchedPods(client, now).catch((e) => console.error("Sweep error:", e));
}

async function driveScheduledPod(client: Client, pod: Pod, now: number): Promise<void> {
  const start = pod.opts.scheduledAt!;

  if (!pod.reminderSent && now >= start - REMINDER_LEAD_MS && now < start) {
    pod.reminderSent = true;
    podStore.save(pod);
    const mentions = pod.seats.map((id) => `<@${id}>`).join(" ");
    await sendToChannel(
      client,
      pod.opts.channelId,
      `${mentions} — **${pod.opts.title}** starts <t:${Math.floor(start / 1000)}:R>.`,
    );
  }

  if (now >= start) {
    try {
      await launchPod(client, pod);
    } catch (err) {
      pod.launchFailures += 1;
      if (pod.launchFailures >= MAX_AUTO_LAUNCH_ATTEMPTS) {
        await failScheduledPod(client, pod, err);
      }
    }
  }
}

/** Give up on a scheduled pod that repeatedly failed to auto-launch. */
async function failScheduledPod(client: Client, pod: Pod, err: unknown): Promise<void> {
  if (pod.status !== "open") return;
  const reason =
    err instanceof LaunchError ? err.message : "the EDH Play room couldn't be created";
  const notify = await cancelPod(client, pod);
  const mentions = notify.map((id) => `<@${id}>`).join(" ");
  await sendToChannel(
    client,
    pod.opts.channelId,
    `${mentions} — **${pod.opts.title}** couldn't auto-launch: ${reason}`,
  );
}

async function sendToChannel(
  client: Client,
  channelId: string,
  content: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased() && "send" in channel) {
    await channel.send(content).catch(() => undefined);
  }
}

client.login(config.discordToken);
