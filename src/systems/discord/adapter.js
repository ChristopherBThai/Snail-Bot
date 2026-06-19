import { createRestManager } from '@discordeno/rest';
import { ComponentType, InteractionResponseType, MessageFlags } from 'discord-api-types/v10';

export function createDiscordAdapter(token) {
    const rest = createRestManager({ token }).preferSnakeCase(true);

    return {
        async syncGuildCommands(applicationId, guildId, commands) {
            await rest.put(rest.routes.interactions.commands.guilds.all(applicationId, guildId), {
                body: commands
            });
        },

        async respond(interaction, message) {
            await rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                body: {
                    type: InteractionResponseType.ChannelMessageWithSource,
                    data:
                        typeof message === 'string'
                            ? {
                                  flags: MessageFlags.IsComponentsV2,
                                  components: [
                                      {
                                          type: ComponentType.TextDisplay,
                                          content: message
                                      }
                                  ]
                              }
                            : message
                },
                runThroughQueue: false,
                unauthorized: true
            });
        }
    };
}
