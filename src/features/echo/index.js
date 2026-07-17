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
                        let result = await services.messageBuilder.start(context, {
                            authorize: hasManagerAccess,
                            label: `Send to <#${channelId}>`,
                            mode: services.messageBuilder.OpenModes.Resume,
                            submitLabel: 'Send Message'
                        });

                        while (result.type === services.messageBuilder.SubmitResults.Submitted) {
                            let sentMessage;
                            try {
                                sentMessage = await result.context.sendMessage(channelId, result.message);
                            } catch {
                                result = await result.reject('Could not send that message.');
                                continue;
                            }

                            await result.confirm(
                                `Echoed message ${getMessageJumpLink({
                                    channelId: sentMessage.channel_id,
                                    guildId: result.context.guildId,
                                    messageId: sentMessage.id
                                })}`
                            );
                            return;
                        }

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
