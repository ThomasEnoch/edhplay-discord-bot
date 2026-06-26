import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commandData } from "./commands/index.js";

// Registers slash commands. With DISCORD_GUILD_ID set, commands appear in that
// guild instantly (best for development). Without it, they register globally
// and can take up to an hour to show up.

const rest = new REST({ version: "10" }).setToken(config.discordToken);

async function main() {
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  const data = (await rest.put(route, { body: commandData })) as unknown[];
  console.log(
    `Registered ${data.length} commands ${config.guildId ? `to guild ${config.guildId}` : "globally"}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
