import { ApplicationCommandType } from 'discord-api-types/v10';
import { hasManagerAccess } from '../discord/auth.js';
import { getTargetMessage } from '../discord/interactions.js';
import { getMessageJumpLink } from '../discord/messages.js';

const EDIT_COMMAND_DEFINITION = {
    type: ApplicationCommandType.Message,
    name: 'edit',
};

/** @type {import('../packages.js').PackageSetup} */
export default function setup({ messageBuilder, rest }) {
    return {
        name: 'Edit Command',
        missing: messageBuilder.missing.length ? ['Message Builder (system)'] : [],
        commands: [
            {
                definition: EDIT_COMMAND_DEFINITION,
                staff: true,
                authorize: hasManagerAccess,
                async handle(context) {
                    const message = getTargetMessage(context.interaction);
                    if (!message) {
                        await context.respond('Could not read that message.', { ephemeral: true });
                        return;
                    }

                    const applicationId = context.interaction.applicationId;
                    if (message.author?.id !== applicationId && message.applicationId !== applicationId) {
                        await context.respond('I can only edit messages sent by Snail.', { ephemeral: true });
                        return;
                    }

                    const channelId = message.channelId ?? context.interaction.channelId;
                    const messageId = message.id;
                    if (!channelId || !messageId) {
                        await context.respond('Could not read that message channel.', { ephemeral: true });
                        return;
                    }

                    await messageBuilder.start(context, {
                        authorize: hasManagerAccess,
                        sourceMessage: message,
                        allowMentions: true,
                        title: 'Edit Message',
                        submitLabel: 'Update Message',
                        async submit(builtMessage) {
                            await rest.editMessage(channelId, messageId, {
                                content: null,
                                embeds: [],
                                attachments: [],
                                ...builtMessage,
                            });

                            return {
                                ok: true,
                                message: `Updated message ${getMessageJumpLink({
                                    guildId: context.interaction.guildId,
                                    channelId,
                                    messageId,
                                })}`,
                            };
                        },
                    });
                },
            },
        ],
    };
}
