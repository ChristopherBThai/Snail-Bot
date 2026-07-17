import { ApplicationCommandType } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { getMessageJumpLink } from '../../discord/utils.js';

export default function setupEdit({ services }) {
    return {
        routes: [
            {
                kind: 'command',
                id: 'edit:command',
                command: {
                    type: ApplicationCommandType.Message,
                    name: 'edit',
                    staff: true
                },
                authorize: hasManagerAccess,
                async handle(context) {
                    const message = context.target.message;

                    if (!message || !context.target.id) {
                        await context.respond('Could not read that message.', { ephemeral: true });
                        return;
                    }

                    if (!isOwnMessage(message, context)) {
                        await context.respond('I can only edit messages sent by Snail.', { ephemeral: true });
                        return;
                    }

                    const channelId = message.channel_id ?? context.channelId;
                    if (!channelId) {
                        await context.respond('Could not read that message channel.', { ephemeral: true });
                        return;
                    }

                    await services.messageBuilder.start(context, {
                        authorize: hasManagerAccess,
                        label: `Edit message ${getMessageJumpLink({
                            channelId,
                            guildId: context.guildId,
                            messageId: context.target.id
                        })}`,
                        sourceMessage: message,
                        submitError: 'Could not update that message.',
                        async submit({ context: submitContext, message: builtMessage }) {
                            await submitContext.editMessage(channelId, context.target.id, {
                                content: null,
                                embeds: [],
                                attachments: [],
                                ...builtMessage
                            });

                            return `Updated message ${getMessageJumpLink({
                                channelId,
                                guildId: context.guildId,
                                messageId: context.target.id
                            })}`;
                        },
                        submitLabel: 'Update Message'
                    });
                    return;
                }
            }
        ]
    };
}

function isOwnMessage(message, context) {
    const authorId = message.author?.id ?? message.author_id;
    const applicationId = message.application_id;

    return authorId === context.applicationId || applicationId === context.applicationId;
}
