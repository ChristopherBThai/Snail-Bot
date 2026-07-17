import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { getCommandOptionValue, getMessageJumpLink } from '../../discord/utils.js';

export default function setupEcho({ services }) {
    return {
        routes: [
            {
                kind: 'command',
                id: 'echo:command',
                command: {
                    type: ApplicationCommandType.ChatInput,
                    name: 'echo',
                    description: 'Send a message to a channel.',
                    staff: true,
                    options: [
                        {
                            name: 'channel',
                            description: 'The channel to send the message in.',
                            type: ApplicationCommandOptionType.Channel,
                            required: true
                        },
                        {
                            name: 'message',
                            description: 'The message to send. Omit to open Message Builder.',
                            type: ApplicationCommandOptionType.String,
                            required: false,
                            min_length: 1
                        }
                    ]
                },
                authorize: hasManagerAccess,
                async handle(context) {
                    const channelId = getCommandOptionValue(context, 'channel');
                    const message = getCommandOptionValue(context, 'message').trim();

                    if (!message) {
                        await services.messageBuilder.start(context, {
                            authorize: hasManagerAccess,
                            label: `Send to <#${channelId}>`,
                            submitError: 'Could not send that message.',
                            async submit({ context: submitContext, message: builtMessage }) {
                                const sentMessage = await submitContext.sendMessage(channelId, builtMessage);

                                return `Echoed message ${getMessageJumpLink({
                                    channelId: sentMessage.channel_id,
                                    guildId: submitContext.guildId,
                                    messageId: sentMessage.id
                                })}`;
                            },
                            submitLabel: 'Send Message'
                        });
                        return;
                    }

                    const sentMessage = await context.sendMessage(channelId, message);
                    await context.respond(
                        `Echoed message ${getMessageJumpLink({
                            channelId: sentMessage.channel_id,
                            guildId: context.guildId,
                            messageId: sentMessage.id
                        })}`,
                        {
                            ephemeral: true
                        }
                    );
                }
            }
        ]
    };
}
