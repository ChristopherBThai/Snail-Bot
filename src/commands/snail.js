import { ApplicationCommandType, ComponentType, InteractionResponseType, MessageFlags } from 'discord-api-types/v10';

const SNAIL_MESSAGE = {
    flags: MessageFlags.IsComponentsV2,
    components: [
        {
            type: ComponentType.TextDisplay,
            content: '🐌',
        },
    ],
};

const SNAIL_COMMAND_DEFINITION = {
    type: ApplicationCommandType.ChatInput,
    name: 'snail',
    description: '🐌',
};

export default function setup({ rest }) {
    return {
        name: 'Snail Command',
        commands: [
            {
                definition: SNAIL_COMMAND_DEFINITION,
                async handle(interaction) {
                    await rest.sendInteractionResponse(interaction.id, interaction.token, {
                        type: InteractionResponseType.ChannelMessageWithSource,
                        data: SNAIL_MESSAGE,
                    });
                },
            },
        ],
    };
}
