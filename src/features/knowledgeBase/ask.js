import { randomUUID } from 'node:crypto';
import { ApplicationCommandOptionType, ApplicationCommandType, ChannelType, MessageType } from 'discord-api-types/v10';
import { getCommandOptionValue, getCustomIdSuffix, getInteractionUser } from '../../discord/interactions.js';
import {
    buildAnswer,
    buildAskThreadStarter,
    buildFeedbackReport,
    disableFeedbackMessage,
    extractAskAnswer,
    extractAskQuestion,
    IDS,
    isAskAnswerMessage,
} from './render.js';

const COOLDOWN = 5_000;
const FEEDBACK_LIFETIME = 30 * 60_000;
const ASK_HISTORY_FETCH_LIMIT = 100;
const ASK_HISTORY_MAX_TURNS = 5;
const ASK_HISTORY_MAX_CHARS = 6_000;

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
    const state = { botUserId: String(rest.applicationId), feedbackChannelId: undefined };

    return {
        state,
        initialize,
        handleMessage,
        setFeedbackChannel,
        clearFeedbackChannel,
        handleCommand,
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

    async function handleCommand(context) {
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
        const channel = context.interaction.channel;
        const history = isSnailAskThreadChannel(channel, state.botUserId)
            ? await fetchConversationHistory(channel.id)
            : [];

        let starter;
        let deliveryChannel;
        if (channel && !isThreadChannel(channel)) {
            starter = await context.editResponse(buildAskThreadStarter(question));
            try {
                deliveryChannel = await rest.startThreadWithMessage(channel.id, starter.id, {
                    name: buildThreadName(question),
                    autoArchiveDuration: 60,
                });
            } catch (error) {
                log.warn('Could not create Knowledge Base answer thread; using the interaction response', {
                    error,
                    channelId: channel.id,
                    messageId: starter.id,
                });
            }
        }

        if (deliveryChannel) {
            await rest.triggerTypingIndicator(deliveryChannel.id).catch((error) =>
                log.debug('Could not send Knowledge Base typing indicator', {
                    error,
                    channelId: deliveryChannel.id,
                }),
            );
        }
        const result = await knowledge.ask(question, history);
        timer.checkpoint('answer');
        const feedbackId = rememberFeedback({
            userId,
            question,
            displaysQuestion: true,
            ...(starter ? { questionMessage: messageIdentity(starter) } : {}),
            ...result,
        });
        const answerPayload = buildAnswer(result.answer, result.sources, feedbackId, question);
        let message;
        if (deliveryChannel) {
            try {
                message = await rest.sendMessage(deliveryChannel.id, {
                    ...answerPayload,
                    messageReference: { messageId: starter.id, failIfNotExists: false },
                });
            } catch (error) {
                log.warn('Could not post Knowledge Base answer in its thread; using the interaction response', {
                    error,
                    channelId: channel.id,
                    messageId: starter.id,
                    threadId: deliveryChannel.id,
                });
                message = await context.editResponse(answerPayload);
            }
        } else {
            message = await context.editResponse(answerPayload);
        }
        const record = feedback.get(feedbackId);
        record.questionMessage ??= messageIdentity(message);
        rememberAnswerMessage(feedbackId, message);
        timer.info('Answered Knowledge Base question', {
            userId,
            channelId: message.channelId,
            messageId: message.id,
            resources: result.sources.length,
        });
    }

    async function handleMessage(message) {
        if (message.author?.bot || !state.botUserId) return;

        let candidate = message;
        if (!hasExplicitMention(message.content, state.botUserId)) {
            if (message.type !== MessageType.Reply) return;
            candidate = { ...message, referencedMessage: await resolveReferencedMessage(message) };
        }
        if (!isEligibleAskMessage(candidate, state.botUserId)) return;

        const question = cleanQuestion(message.content, state.botUserId);
        if (!question || question.length > 500) return;
        const channel = await rest.getChannel(message.channelId);
        await answerMessage(message, question, channel);
    }

    async function answerMessage(message, question, channel) {
        let deliveryChannel = channel;
        if (!isThreadChannel(channel)) {
            try {
                deliveryChannel = await rest.startThreadWithMessage(channel.id, message.id, {
                    name: buildThreadName(question),
                    autoArchiveDuration: 60,
                });
            } catch (error) {
                log.warn('Could not create Knowledge Base answer thread; replying in the original channel', {
                    error,
                    channelId: channel.id,
                    messageId: message.id,
                });
            }
        }

        await rest
            .triggerTypingIndicator(deliveryChannel.id)
            .catch((error) =>
                log.debug('Could not send Knowledge Base typing indicator', { error, channelId: deliveryChannel.id }),
            );
        const history =
            deliveryChannel.id === channel.id && isSnailAskThreadChannel(channel, state.botUserId)
                ? await fetchConversationHistory(channel.id, message.id)
                : [];
        const result = await knowledge.ask(question, history);
        const feedbackId = rememberFeedback({
            userId: message.author.id,
            question,
            questionMessage: messageIdentity(message),
            ...result,
        });
        const payload = {
            ...buildAnswer(result.answer, result.sources, feedbackId),
            messageReference: { messageId: message.id, failIfNotExists: false },
        };

        let answer;
        try {
            answer = await rest.sendMessage(deliveryChannel.id, payload);
        } catch (error) {
            if (deliveryChannel.id === channel.id) throw error;
            log.warn('Could not post Knowledge Base answer in its thread; replying in the original channel', {
                error,
                channelId: channel.id,
                messageId: message.id,
                threadId: deliveryChannel.id,
            });
            answer = await rest.sendMessage(channel.id, payload);
        }
        rememberAnswerMessage(feedbackId, answer);
        log.info('Answered Knowledge Base message question', {
            userId: message.author.id,
            channelId: answer.channelId,
            messageId: answer.id,
            resources: result.sources.length,
        });
    }

    async function resolveReferencedMessage(message) {
        if (message.referencedMessage !== undefined) return message.referencedMessage ?? undefined;
        const referencedMessageId = getReferencedMessageId(message);
        if (!referencedMessageId) return undefined;

        try {
            return await rest.getMessage(message.channelId, referencedMessageId);
        } catch (error) {
            log.debug('Could not fetch referenced Knowledge Base message', {
                error,
                channelId: message.channelId,
                messageId: referencedMessageId,
            });
        }
    }

    async function fetchConversationHistory(channelId, currentMessageId) {
        const messages = await rest.getMessages(channelId, { limit: ASK_HISTORY_FETCH_LIMIT });
        const byId = new Map(messages.map((message) => [String(message.id), message]));
        const enriched = await Promise.all(
            messages
                .filter((message) => String(message.id) !== String(currentMessageId))
                .map(async (message) => {
                    if (message.referencedMessage !== undefined) return message;
                    const referencedMessageId = getReferencedMessageId(message);
                    if (!referencedMessageId) return message;
                    const referencedMessage =
                        byId.get(referencedMessageId) ??
                        (await rest.getMessage(channelId, referencedMessageId).catch(() => undefined));
                    return { ...message, referencedMessage };
                }),
        );
        return buildAskConversationHistory(enriched, state.botUserId);
    }

    function rememberFeedback(record) {
        const id = randomUUID();
        record.timeout = setTimeout(() => expireFeedback(id, record), FEEDBACK_LIFETIME);
        feedback.set(id, record);
        return id;
    }

    function rememberAnswerMessage(feedbackId, message) {
        feedback.get(feedbackId).message = messageIdentity(message);
    }

    async function expireFeedback(id, record) {
        if (feedback.get(id) !== record) return;
        feedback.delete(id);
        if (!record.message) return;

        try {
            await rest.editMessage(
                record.message.channelId,
                record.message.id,
                disableFeedbackMessage(
                    buildAnswer(
                        record.answer,
                        record.sources,
                        id,
                        record.displaysQuestion ? record.question : undefined,
                    ),
                    '',
                ),
            );
        } catch (error) {
            log.debug('Could not disable expired Knowledge Base feedback controls', { error, feedbackId: id });
        }
    }
}

function messageIdentity(message) {
    return { guildId: message.guildId, channelId: message.channelId, id: message.id };
}

function buildThreadName(question) {
    return `Ask · ${question.replace(/\s+/g, ' ').trim()}`.slice(0, 100);
}

function getQuestion(interaction) {
    return String(getCommandOptionValue(interaction, 'question') ?? '').trim();
}

function hasExplicitMention(content, botUserId) {
    if (!botUserId) return false;
    return new RegExp(`<@!?${botUserId}>`).test(String(content ?? ''));
}

function isEligibleAskMessage(message, botUserId, answerMessageIds = new Set()) {
    if (message?.author?.bot) return false;
    if (hasExplicitMention(message?.content, botUserId)) return true;
    if (message?.type !== MessageType.Reply) return false;

    const referencedMessageId = getReferencedMessageId(message);
    return (
        (referencedMessageId && answerMessageIds.has(referencedMessageId)) ||
        isAskAnswerMessage(message?.referencedMessage, botUserId)
    );
}

function isSnailAskThreadChannel(channel, botUserId) {
    return isThreadChannel(channel) && Boolean(botUserId && channel?.ownerId === botUserId);
}

function isThreadChannel(channel) {
    return [ChannelType.GuildNewsThread, ChannelType.GuildPublicThread, ChannelType.GuildPrivateThread].includes(
        channel?.type,
    );
}

function buildAskConversationHistory(messages, botUserId) {
    const answerMessageIds = new Set();
    const pendingQuestions = [];
    const turns = [];

    for (const message of [...(messages ?? [])].sort(compareMessageIds)) {
        if (isAskAnswerMessage(message, botUserId)) {
            answerMessageIds.add(String(message.id));
            const embeddedQuestion = extractAskQuestion(message);
            if (embeddedQuestion) {
                turns.push({ user: embeddedQuestion, assistant: extractAskAnswer(message) });
                continue;
            }
            const referencedMessageId = getReferencedMessageId(message);
            const referencedIndex = referencedMessageId
                ? pendingQuestions.findIndex((question) => question.id === referencedMessageId)
                : -1;
            const question = referencedMessageId
                ? referencedIndex >= 0
                    ? pendingQuestions.splice(referencedIndex, 1)[0]
                    : undefined
                : pendingQuestions.shift();
            if (question) turns.push({ user: question.content, assistant: extractAskAnswer(message) });
            continue;
        }

        if (!isEligibleAskMessage(message, botUserId, answerMessageIds)) continue;
        const content = cleanQuestion(message.content, botUserId);
        if (content) pendingQuestions.push({ id: String(message.id), content });
    }

    return capHistory(turns);
}

function cleanQuestion(content, botUserId) {
    return String(content ?? '')
        .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getReferencedMessageId(message) {
    const id = message?.messageReference?.messageId ?? message?.messageReference?.message_id;
    return id === undefined ? undefined : String(id);
}

function capHistory(turns) {
    const capped = [];
    let chars = 0;

    for (const turn of turns.slice(-ASK_HISTORY_MAX_TURNS).toReversed()) {
        const pair = [
            { role: 'user', content: turn.user },
            { role: 'assistant', content: turn.assistant },
        ].filter((item) => item.content);
        const pairChars = pair.reduce((total, item) => total + item.content.length, 0);
        if (capped.length && chars + pairChars > ASK_HISTORY_MAX_CHARS) break;
        if (!capped.length && pairChars > ASK_HISTORY_MAX_CHARS) {
            const itemBudget = Math.floor(ASK_HISTORY_MAX_CHARS / pair.length);
            capped.unshift(...pair.map((item) => ({ ...item, content: truncate(item.content, itemBudget) })));
            break;
        }
        capped.unshift(...pair);
        chars += pairChars;
    }

    return capped;
}

function truncate(content, maxChars) {
    if (content.length <= maxChars) return content;
    return `${content.slice(0, Math.max(0, maxChars - 1))}…`;
}

function compareMessageIds(left, right) {
    try {
        const leftId = BigInt(left.id);
        const rightId = BigInt(right.id);
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    } catch {
        return String(left.id).localeCompare(String(right.id));
    }
}
