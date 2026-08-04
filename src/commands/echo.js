import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord-api-types/v10';
import { hasManagerAccess } from '../discord/auth.js';
import { getCommandOptionValue } from '../discord/interactions.js';
import { getMessageJumpLink, normalizeMessage } from '../discord/messages.js';

const ECHO_COMMAND_DEFINITION = {
    type: ApplicationCommandType.ChatInput,
    name: 'echo',
    description: 'Send a message to a channel.',
    options: [
        {
            type: ApplicationCommandOptionType.Channel,
            name: 'channel',
            description: 'The channel to send the message in.',
            required: true,
        },
        {
            type: ApplicationCommandOptionType.String,
            name: 'message',
            description: 'Plain text to send. Leave blank to open Message Builder.',
            required: false,
            minLength: 1,
        },
    ],
};

/** @type {import('../packages.js').PackageSetup} */
export default function setup({ messageBuilder, rest }) {
    return {
        name: 'Echo Command',
        missing: messageBuilder.missing.length ? ['Message Builder (system)'] : [],
        commands: [
            {
                definition: ECHO_COMMAND_DEFINITION,
                staff: true,
                authorize: hasManagerAccess,
                async handle(context) {
                    const channelId = getCommandOptionValue(context.interaction, 'channel');
                    const message = getCommandOptionValue(context.interaction, 'message')?.trim();

                    if (message) {
                        const sentMessage = await rest.sendMessage(channelId, normalizeMessage(message));
                        await context.respond(successMessage(context.interaction.guildId, sentMessage), {
                            ephemeral: true,
                        });
                        return;
                    }

                    await messageBuilder.start(context, {
                        authorize: hasManagerAccess,
                        allowMentions: true,
                        title: `Send to <#${channelId}>`,
                        submitLabel: 'Send Message',
                        async submit(builtMessage) {
                            const sentMessage = await rest.sendMessage(channelId, builtMessage);
                            return {
                                ok: true,
                                message: successMessage(context.interaction.guildId, sentMessage),
                            };
                        },
                    });
                },
            },
        ],
    };
}

function successMessage(guildId, message) {
    return `Echoed message ${getMessageJumpLink({
        guildId,
        channelId: message.channelId,
        messageId: message.id,
    })}`;
}
