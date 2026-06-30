import { ApplicationCommandType } from 'discord-api-types/v10';
import { ephemeralText } from '../systems/discord/components.js';
import {
    buildCompiledMessage,
    createDraftFromMessage,
    HydrationRejectReasons,
    OpenModes,
    validateRenderableDraft
} from '../systems/message-builder/index.js';
import { auth } from '../utils.js';

export function createEditCommand({ messageBuilder }) {
    return {
        auth: auth.manager,
        staff: true,
        definition: {
            name: 'edit',
            type: ApplicationCommandType.Message
        },
        async handle(context) {
            const message = context.target;
            if (!message || !context.targetID) {
                await context.respond(ephemeralText('Could not read that message.'));
                return;
            }

            if (!isOwnMessage(message, context)) {
                await context.respond(ephemeralText('I can only edit messages sent by Snail.'));
                return;
            }

            const channelID = getMessageChannelID(message, context);
            if (!channelID) {
                await context.respond(ephemeralText('Could not read that message channel.'));
                return;
            }

            const result = createDraftFromMessage(message, { ownerID: context.userID });
            if (!result.ok) {
                await context.respond(ephemeralText(formatHydrationRejectReason(result.reason)));
                return;
            }

            await messageBuilder.start(context, {
                auth: auth.manager,
                blocks: result.draft.blocks,
                label: 'Edit message',
                mode: OpenModes.ReplaceFromBlocks,
                selectedBlockPath: result.draft.selectedBlockPath,
                submit: ({ context: submitContext, draft }) =>
                    submitMessageEdit(submitContext, draft, {
                        channelID,
                        messageID: context.targetID
                    }),
                submitLabel: 'Update Message',
                validators: [validateRenderableDraft]
            });
        }
    };
}

async function submitMessageEdit(context, draft, { channelID, messageID }) {
    await context.editMessage(channelID, messageID, {
        content: null,
        embeds: [],
        attachments: [],
        ...buildCompiledMessage(draft.blocks, { suppressMentions: false })
    });

    return { ok: true, message: 'Updated the message.' };
}

function isOwnMessage(message, context) {
    const authorID = message.author?.id ?? message.author_id ?? message.authorId;
    const messageApplicationID = message.application_id ?? message.applicationId;

    return authorID === context.applicationID || messageApplicationID === context.applicationID;
}

function getMessageChannelID(message, context) {
    return message.channel_id ?? message.channelId ?? context.channelID;
}

function formatHydrationRejectReason(reason) {
    switch (reason) {
        case HydrationRejectReasons.Attachments:
            return 'That message cannot be edited because it has attachments.';
        case HydrationRejectReasons.Embeds:
            return 'That message cannot be edited because it has embeds.';
        case HydrationRejectReasons.UnsupportedContent:
            return 'That message cannot be edited because it has unsupported message content.';
        case HydrationRejectReasons.TooComplex:
            return 'That message has more editable blocks than Message Builder supports.';
        default:
            return 'That message cannot be edited because it uses unsupported components.';
    }
}
