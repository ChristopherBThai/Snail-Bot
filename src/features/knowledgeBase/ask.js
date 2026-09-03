import { randomUUID } from 'node:crypto';
import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord-api-types/v10';
import { getCommandOptionValue, getCustomIdSuffix, getInteractionUser } from '../../discord/interactions.js';
import { buildAnswer, buildFeedbackReport, disableFeedbackMessage, IDS } from './render.js';

const COOLDOWN = 5_000;
const FEEDBACK_LIFETIME = 30 * 60_000;

export const ASK_COMMAND = {
    type: ApplicationCommandType.ChatInput,
    name: 'ask',
    description: 'Ask Snail an OwO support question.',
    options: [
        {
            type: ApplicationCommandOptionType.String,
            name: 'question',
            description: 'Your question.',
            required: true,
            minLength: 1,
            maxLength: 500,
        },
    ],
};

export function createAsk({ knowledge, log, Setting, rest }) {
    const cooldowns = new Set();
    const feedback = new Map();
    const state = { feedbackChannelId: undefined };

    return {
        state,
        initialize,
        setFeedbackChannel,
        clearFeedbackChannel,
        async handleCommand(context) {
            const question = getQuestion(context.interaction);
            const userId = getInteractionUser(context.interaction)?.id;
            if (!question || !userId) {
                await context.respond('Enter a question between 1 and 500 characters.', { ephemeral: true });
                return;
            }
            if (cooldowns.has(userId)) {
                await context.respond('Please wait a few seconds before asking another question.', { ephemeral: true });
                return;
            }

            cooldowns.add(userId);
            setTimeout(() => cooldowns.delete(userId), COOLDOWN);
            const timer = log.time();
            await context.defer();
            const result = await knowledge.ask(question);
            timer.checkpoint('answer');
            const feedbackId = rememberFeedback({ userId, question, ...result });
            const message = await context.editResponse(buildAnswer(result.answer, result.sources, feedbackId));
            feedback.get(feedbackId).message = {
                guildId: message.guildId,
                channelId: message.channelId,
                id: message.id,
            };
            timer.info('Answered Knowledge Base question', {
                userId,
                resources: result.sources.length,
            });
        },
        async submitFeedback(context) {
            const [feedbackId, rating] = getCustomIdSuffix(context.interaction, IDS.feedback).split(':');
            const record = feedback.get(feedbackId);
            const userId = getInteractionUser(context.interaction)?.id;

            if (record && record.userId !== userId) {
                await context.respond('Only the person who asked the question can rate this answer.', {
                    ephemeral: true,
                });
                return;
            }
            if (!record || !['helpful', 'needsFix'].includes(rating)) {
                await context.update(disableFeedbackMessage(context.interaction.message, ''));
                await context.respond('That feedback prompt has expired.', { ephemeral: true });
                return;
            }

            feedback.delete(feedbackId);
            clearTimeout(record.timeout);
            try {
                await context.update(
                    disableFeedbackMessage(context.interaction.message, context.interaction.data.customId),
                );
            } catch (error) {
                log.debug('Could not disable Knowledge Base feedback controls', { error, feedbackId });
            }

            const channelId = state.feedbackChannelId;
            if (channelId && record.message) {
                try {
                    await rest.sendMessage(
                        channelId,
                        buildFeedbackReport({ rating, ...record, message: record.message }),
                    );
                } catch (error) {
                    log.error('Could not forward Knowledge Base feedback', { error, feedbackId, rating, userId });
                }
            }
            await context.respond('Thank you for the feedback!', { ephemeral: true });
        },
    };

    async function initialize() {
        const settings = await Setting.loadValues('knowledgeBase');
        state.feedbackChannelId = settings.feedbackChannelId;
    }

    async function setFeedbackChannel(channelId) {
        await Setting.saveValue('knowledgeBase', 'feedbackChannelId', channelId);
        state.feedbackChannelId = channelId;
    }

    async function clearFeedbackChannel() {
        await Setting.deleteValue('knowledgeBase', 'feedbackChannelId');
        state.feedbackChannelId = undefined;
    }

    function rememberFeedback(record) {
        const id = randomUUID();
        record.timeout = setTimeout(() => expireFeedback(id, record), FEEDBACK_LIFETIME);
        feedback.set(id, record);
        return id;
    }

    async function expireFeedback(id, record) {
        if (feedback.get(id) !== record) return;
        feedback.delete(id);
        if (!record.message) return;

        try {
            await rest.editMessage(
                record.message.channelId,
                record.message.id,
                disableFeedbackMessage(buildAnswer(record.answer, record.sources, id), ''),
            );
        } catch (error) {
            log.debug('Could not disable expired Knowledge Base feedback controls', { error, feedbackId: id });
        }
    }
}

function getQuestion(interaction) {
    return String(getCommandOptionValue(interaction, 'question') ?? '').trim();
}
