import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord-api-types/v10';
import { hasManagerAccess } from '../auth.js';

const NICK_COMMAND_DEFINITION = {
    type: ApplicationCommandType.ChatInput,
    name: 'nick',
    description: "Set or reset Snail's server nickname.",
    options: [
        {
            type: ApplicationCommandOptionType.String,
            name: 'nickname',
            description: 'The new nickname. Leave empty to clear it.',
            required: false,
            minLength: 1,
            maxLength: 32,
        },
    ],
};

export default function setup({ config, rest }) {
    return {
        name: 'Nick Command',
        missing: config.roles?.manager?.permission ? [] : ['roles.manager.permission (config)'],
        commands: [
            {
                definition: NICK_COMMAND_DEFINITION,
                staff: true,
                authorize: hasManagerAccess,
                async handle({ interaction, respond }) {
                    if (!interaction.guildId) {
                        await respond('This command can only be used in a server!', {
                            ephemeral: true,
                        });
                        return;
                    }

                    const value = interaction.data.options?.find((option) => option.name === 'nickname')?.value;
                    const nickname = typeof value === 'string' ? value.trim() : '';

                    await rest.editBotMember(interaction.guildId, { nick: nickname || null });
                    await respond(
                        nickname ? `I have set my nickname to \`${nickname}\`.` : 'I have reset my nickname.',
                        { ephemeral: true },
                    );
                },
            },
        ],
    };
}
