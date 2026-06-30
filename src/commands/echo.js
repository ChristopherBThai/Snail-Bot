import { ApplicationCommandOptionType } from 'discord-api-types/v10';
import { componentsMessage, ephemeralText, textDisplay } from '../systems/discord/components.js';
import { buildCompiledMessage, OpenModes, validateRenderableDraft } from '../systems/message-builder/index.js';
import { auth, getOptionValue } from '../utils.js';

export function createEchoCommand({ messageBuilder }) {
    return {
        auth: auth.manager,
        staff: true,
        definition: {
            name: 'echo',
            description: 'Echo a message to a channel. Leave message blank to open Message Builder.',
            options: [
                {
                    name: 'channel',
                    description: 'The channel to send the message in.',
                    type: ApplicationCommandOptionType.Channel,
                    required: true
                },
                {
                    name: 'message',
                    description: 'Plain text to send. Leave blank to open Message Builder.',
                    type: ApplicationCommandOptionType.String,
                    required: false
                }
            ]
        },
        async handle(context) {
            const channelID = getChannelID(context);
            if (!channelID) {
                await context.respond(ephemeralText('Choose a valid channel.'));
                return;
            }

            const message = getOptionValue(context.data, 'message');
            if (typeof message === 'string' && message.trim()) {
                await sendRawEcho(context, channelID, message);
                return;
            }

            await messageBuilder.start(context, {
                auth: auth.manager,
                label: `Send to <#${channelID}>`,
                mode: OpenModes.Resume,
                submit: ({ context: submitContext, draft }) => submitChannelMessage(submitContext, draft, channelID),
                submitLabel: 'Send Message',
                validators: [validateRenderableDraft]
            });
        }
    };
}

async function sendRawEcho(context, channelID, message) {
    await context.sendMessage(channelID, componentsMessage(textDisplay(message.trim())));
    await context.respond(ephemeralText(`Echoed message in <#${channelID}>.`));
}

async function submitChannelMessage(context, draft, channelID) {
    await context.sendMessage(channelID, buildCompiledMessage(draft.blocks, { suppressMentions: false }));

    return { ok: true, message: `Sent built message to <#${channelID}>.` };
}

function getChannelID(context) {
    return String(getOptionValue(context.data, 'channel') ?? '').match(/\d{17,20}/)?.[0];
}
