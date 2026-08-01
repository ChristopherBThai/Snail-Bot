const ASK_HISTORY_FETCH_LIMIT = 100;
const ASK_HISTORY_MAX_TURNS = 5;
const ASK_HISTORY_MAX_CHARS = 6000;
const ASK_RETRIEVAL_HISTORY_MAX_CHARS = 1200;
const ASK_WARNING_PREFIX = '> -# ⚠️ Snail may be incorrect. This feature is still a work in progress!';

function isSnailAskThreadChannel(channel, botUserId) {
    return (
        isThreadChannel(channel) &&
        Boolean(botUserId && channel?.ownerID === botUserId) &&
        String(channel?.name ?? '')
            .toLowerCase()
            .startsWith('snail ask')
    );
}

function buildAskConversationHistory(messages, botUserId, prefixes = []) {
    const chronological = [...(messages || [])].sort(compareDiscordMessageIds);
    const askAnswerMessageIds = new Set();
    const pendingUsers = [];
    const turns = [];

    for (const message of chronological) {
        if (isBotMessage(message, botUserId)) {
            if (!isSnailAskAnswerMessage(message, botUserId)) continue;

            askAnswerMessageIds.add(String(message.id));
            const referencedUserId = getReferencedMessageId(message);
            const referencedUserIndex = referencedUserId
                ? pendingUsers.findIndex((pending) => pending.id === String(referencedUserId))
                : -1;
            const pendingUser =
                referencedUserIndex >= 0 ? pendingUsers.splice(referencedUserIndex, 1)[0] : pendingUsers.shift();

            turns.push({
                user: pendingUser?.content,
                assistant: cleanAskAnswerContent(message.content),
            });
            continue;
        }

        if (isAskFlowUserMessage(message, botUserId, askAnswerMessageIds, prefixes)) {
            pendingUsers.push({
                id: String(message.id),
                content: cleanUserMessageContent(message.content, botUserId, prefixes),
            });
        }
    }

    return capAskHistory(turns);
}

function formatRetrievalQuery(question, history) {
    const historyText = formatHistoryForPrompt(history, ASK_RETRIEVAL_HISTORY_MAX_CHARS);
    if (!historyText) return question;
    return `Previous ask conversation:\n${historyText}\n\nCurrent user question:\n${question}`;
}

function capAskHistory(turns) {
    const recentTurns = turns.slice(-ASK_HISTORY_MAX_TURNS);
    const capped = [];
    let chars = 0;

    for (let i = recentTurns.length - 1; i >= 0; i--) {
        const turn = recentTurns[i];
        const pair = [
            { role: 'user', content: turn.user },
            { role: 'assistant', content: turn.assistant },
        ].filter((item) => item.content);
        const pairChars = pair.reduce((total, item) => total + item.content.length, 0);
        if (capped.length && chars + pairChars > ASK_HISTORY_MAX_CHARS) break;
        if (!capped.length && pairChars > ASK_HISTORY_MAX_CHARS) {
            const budget = Math.floor(ASK_HISTORY_MAX_CHARS / pair.length);
            capped.unshift(...pair.map((item) => ({ ...item, content: truncateForHistory(item.content, budget) })));
            break;
        }
        capped.unshift(...pair);
        chars += pairChars;
    }

    return capped;
}

function formatHistoryForPrompt(history, maxChars) {
    const lines = [];
    let chars = 0;

    for (let i = (history || []).length - 1; i >= 0; i--) {
        const item = history[i];
        const content = String(item?.content ?? '').trim();
        if (!content) continue;

        const line = `${item.role === 'assistant' ? 'Snail' : 'User'}: ${content}`;
        if (lines.length && chars + line.length > maxChars) break;
        const truncatedLine = truncateForHistory(line, maxChars);
        lines.unshift(truncatedLine);
        chars += truncatedLine.length;
    }

    return lines.join('\n');
}

function isAskFlowUserMessage(message, botUserId, askAnswerMessageIds, prefixes) {
    if (message.author?.bot) return false;
    if (isAskCommandMessage(message.content, prefixes)) return true;
    if (mentionsBot(message, botUserId)) return true;
    return isReplyToSnailAskAnswerMessage(message, botUserId, askAnswerMessageIds);
}

function isAskCommandMessage(content, prefixes = []) {
    const text = String(content ?? '')
        .trim()
        .toLowerCase();
    if (/^snail\s+ask(?:\s|$)/.test(text)) return true;

    return (prefixes || [])
        .map((prefix) =>
            String(prefix ?? '')
                .trim()
                .toLowerCase()
        )
        .filter(Boolean)
        .some((prefix) => {
            if (!text.startsWith(prefix)) return false;
            const commandText = text.slice(prefix.length).trimStart();
            return commandText === 'ask' || commandText.startsWith('ask ');
        });
}

function isSnailAskAnswerMessage(message, botUserId) {
    if (!isBotMessage(message, botUserId)) return false;
    return String(message.content ?? '').startsWith(ASK_WARNING_PREFIX);
}

function isThreadChannel(channel) {
    return Boolean(channel?.threadMetadata || (channel?.parentID && !channel?.createThreadWithMessage));
}

function isReplyToSnailAskAnswerMessage(message, botUserId, askAnswerMessageIds) {
    if (!botUserId) return false;
    const referencedMessageId = getReferencedMessageId(message);
    if (referencedMessageId && askAnswerMessageIds.has(String(referencedMessageId))) return true;
    return isSnailAskAnswerMessage(message.referencedMessage, botUserId);
}

function getReferencedMessageId(message) {
    return message?.messageReference?.messageID || message?.messageReference?.message_id;
}

function mentionsBot(message, botUserId) {
    if (!botUserId) return false;
    if (message.mentions?.some((user) => user.id === botUserId)) return true;
    return new RegExp(`<@!?${botUserId}>`).test(String(message.content ?? ''));
}

function isBotMessage(message, botUserId) {
    return Boolean(botUserId && message?.author?.id === botUserId);
}

function cleanUserMessageContent(content, botUserId, prefixes) {
    let text = String(content ?? '')
        .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
        .replace(/\s+/g, ' ')
        .trim();

    text = text.replace(/^snail\s+ask\s*/i, '').trim();
    for (const prefix of prefixes || []) {
        const normalizedPrefix = String(prefix ?? '').trim();
        if (!normalizedPrefix) continue;
        const lowerText = text.toLowerCase();
        const lowerPrefix = normalizedPrefix.toLowerCase();
        if (!lowerText.startsWith(lowerPrefix)) continue;

        const commandText = text.slice(normalizedPrefix.length).trimStart();
        if (commandText.toLowerCase() === 'ask') return '';
        if (commandText.toLowerCase().startsWith('ask ')) return commandText.slice(3).trimStart();
    }

    return text;
}

function cleanAskAnswerContent(content) {
    return String(content ?? '')
        .replace(new RegExp(`^${escapeRegExp(ASK_WARNING_PREFIX)}\\s*`, 'i'), '')
        .replace(/\n\n> -# Tags:.*$/s, '')
        .trim();
}

function truncateForHistory(content, maxChars) {
    const text = String(content ?? '').trim();
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function compareDiscordMessageIds(a, b) {
    try {
        const left = BigInt(a.id);
        const right = BigInt(b.id);
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
    } catch {
        return String(a.id).localeCompare(String(b.id));
    }
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    ASK_HISTORY_FETCH_LIMIT,
    ASK_WARNING_PREFIX,
    buildAskConversationHistory,
    formatRetrievalQuery,
    isAskCommandMessage,
    isSnailAskAnswerMessage,
    isSnailAskThreadChannel,
};
