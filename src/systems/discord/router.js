import { ApplicationCommandType, GatewayDispatchEvents, InteractionType } from 'discord-api-types/v10';

export function createInteractionRouter({ commands, discord }) {
    const commandMap = new Map(commands.map((command) => [getCommandKey(command.definition), command]));

    return {
        async route(payload) {
            if (payload.t !== GatewayDispatchEvents.InteractionCreate) {
                return;
            }

            const interaction = payload.d;

            if (interaction.type !== InteractionType.ApplicationCommand) {
                return;
            }

            const command = commandMap.get(getCommandKey(interaction.data));

            await command?.handle(createInteractionContext({ discord, interaction }));
        }
    };
}

function createInteractionContext({ discord, interaction }) {
    return {
        interaction,
        respond(message) {
            return discord.respond(interaction, message);
        }
    };
}

function getCommandKey(command) {
    return `${command.type ?? ApplicationCommandType.ChatInput}:${command.name}`;
}
