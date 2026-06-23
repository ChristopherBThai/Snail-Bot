import commands from './commands/index.js';
import { loadConfig } from './config/index.js';
import { createDatabases } from './database/index.js';
import { ModuleRegistry } from './modules/index.js';
import { QuestListModule } from './modules/quest-list/index.js';
import { createDiscordGateway } from './systems/discord/gateway.js';
import { createDiscordRest } from './systems/discord/rest.js';
import { createInteractionRouter } from './systems/discord/router.js';

async function main() {
    const config = await loadConfig();

    if (!config.discord.token) {
        throw new Error('BOT_TOKEN is required to initialize Discord REST and gateway.');
    }

    if (!config.discord.applicationId) {
        throw new Error('discord.applicationId is required to sync guild commands.');
    }

    if (!config.discord.guildId) {
        throw new Error('discord.guildId is required to sync guild commands.');
    }

    const databases = await createDatabases(config);
    const modules = new ModuleRegistry([new QuestListModule({ config, databases })]);
    await modules.init();

    const rest = createDiscordRest(config.discord.token);
    const registeredCommands = [...commands, ...modules.commands];
    const router = createInteractionRouter({ commands: registeredCommands, config, modules, rest });

    await rest.syncGuildCommands(config.discord.applicationId, config.discord.guildId, registeredCommands);
    console.info(`Synced ${registeredCommands.length.toLocaleString()} guild command(s).`);

    const gateway = createDiscordGateway({ router, token: config.discord.token });
    await gateway.start();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
