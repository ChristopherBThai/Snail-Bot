import { createGatewayManager } from '@discordeno/gateway';
import commands from './commands/index.js';
import { loadConfig } from './config/index.js';
import { createDiscordAdapter } from './systems/discord/adapter.js';
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

    const discord = createDiscordAdapter(config.discord.token);
    const router = createInteractionRouter({ commands, discord });

    await discord.syncGuildCommands(
        config.discord.applicationId,
        config.discord.guildId,
        commands.map((command) => command.definition)
    );

    const gateway = createGatewayManager({
        token: config.discord.token,
        resharding: { enabled: false },
        preferSnakeCase: true,
        events: {
            async message(_shard, payload) {
                await router.route(payload);
            }
        }
    });

    await gateway.spawnShards();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
