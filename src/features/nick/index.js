import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { getCommandOptionValue } from '../../discord/utils.js';

export default {
    routes: [
        {
            kind: 'command',
            id: 'nick:command',
            command: {
                type: ApplicationCommandType.ChatInput,
                name: 'nick',
                description: "Set or reset Snail's server nickname.",
                staff: true,
                options: [
                    {
                        name: 'nickname',
                        description: 'The new nickname. Leave empty to clear it.',
                        type: ApplicationCommandOptionType.String,
                        required: false,
                        min_length: 1,
                        max_length: 32
                    }
                ]
            },
            authorize: hasManagerAccess,
            async handle(context) {
                const nickname = getCommandOptionValue(context, 'nickname').trim();

                if (!context.guildId) {
                    await context.respond('This command can only be used in a sever!', { ephemeral: true });
                    return;
                }

                await context.editBotNickname(context.guildId, nickname || null);

                await context.respond(
                    nickname ? `I have set my nickname to \`${nickname}\`.` : 'I have reset my nickname.',
                    { ephemeral: true }
                );
            }
        }
    ]
};
