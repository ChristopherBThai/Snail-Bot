import { ButtonStyle, ComponentType, MessageFlags, SeparatorSpacingSize, TextInputStyle } from 'discord-api-types/v10';
import { disableComponents, getModalValue } from '../../discord/interactions.js';
import { getMessageJumpLink, suppressMentions } from '../../discord/messages.js';

const ASK_QUESTION_PREFIX = '-# Asked: ';

export const IDS = Object.freeze({
    feedback: 'knowledgeBase:feedback:',
    findPage: 'knowledgeBase:findPage:',
    tagListPage: 'knowledgeBase:tagListPage:',
    questionsEdit: 'knowledgeBase:questionsEdit:',
    questionsRegenerate: 'knowledgeBase:questionsRegenerate:',
    questionsModal: 'knowledgeBase:questionsModal:',
    questionsInput: 'knowledgeBase:questionsInput',
    privateTagModal: 'knowledgeBase:privateTagModal:',
    privateTagInput: 'knowledgeBase:privateTagInput',
});

export function buildTagList(entries, title, sessionId, requestedPage = 0) {
    const pages = packListPages(entries.map((entry) => `\`${entry}\``));
    const page = Math.min(Math.max(Number(requestedPage) || 0, 0), pages.length - 1);
    return panel([
        text(`## ${title}\n${pages[page]}`),
        ...(pages.length > 1
            ? [
                  separator(),
                  {
                      type: ComponentType.ActionRow,
                      components: [
                          button(`${IDS.tagListPage}${sessionId}:${page - 1}`, 'Previous', undefined, page === 0),
                          button(
                              `${IDS.tagListPage}${sessionId}:${page + 1}`,
                              'Next',
                              undefined,
                              page === pages.length - 1,
                          ),
                      ],
                  },
                  text(`-# Page ${page + 1}/${pages.length}`),
              ]
            : []),
    ]);
}

export function buildPrivateTagModal(tagId, textValue = '') {
    return {
        title: `Set Private Tag: ${tagId}`.slice(0, 45),
        customId: `${IDS.privateTagModal}${tagId}`,
        components: [
            {
                type: ComponentType.Label,
                label: 'Tag text',
                component: {
                    type: ComponentType.TextInput,
                    customId: IDS.privateTagInput,
                    style: TextInputStyle.Paragraph,
                    required: true,
                    maxLength: 4000,
                    value: textValue,
                },
            },
        ],
    };
}

export function readPrivateTagText(interaction) {
    return String(getModalValue(interaction, IDS.privateTagInput) ?? '').trim();
}

export function buildQuestions(editor) {
    const questions = editor.questions.map((question) => `- ${question.text}`).join('\n') || '- None';
    const generated = editor.tag.knowledgeBase?.generatedAt
        ? `<t:${Math.floor(new Date(editor.tag.knowledgeBase.generatedAt).getTime() / 1000)}:R>`
        : 'Never';

    return panel([
        text(
            `## Retrieval Questions · ${editor.tag._id}\n` +
                `**Text:** ${(editor.tag.text || '*No searchable text*').slice(0, 1500)}\n` +
                `**Cache:** ${editor.current ? 'Current' : 'Outdated'}\n` +
                `**Generated:** ${generated}`,
        ),
        ...splitText(questions, 3500).map(text),
        separator(),
        {
            type: ComponentType.ActionRow,
            components: [
                button(`${IDS.questionsEdit}${editor.tag._id}`, 'Edit Questions'),
                button(`${IDS.questionsRegenerate}${editor.tag._id}`, 'Regenerate Questions'),
            ],
        },
    ]);
}

export function buildQuestionsModal(editor) {
    return {
        title: `Questions: ${editor.tag._id}`.slice(0, 45),
        customId: `${IDS.questionsModal}${editor.tag._id}`,
        components: [
            {
                type: ComponentType.Label,
                label: 'One question per line',
                description: 'An empty list is valid.',
                component: {
                    type: ComponentType.TextInput,
                    customId: IDS.questionsInput,
                    style: TextInputStyle.Paragraph,
                    required: false,
                    maxLength: 4000,
                    value: editor.questions.map((question) => question.text).join('\n'),
                },
            },
        ],
    };
}

export function readQuestions(interaction) {
    return String(getModalValue(interaction, IDS.questionsInput) ?? '');
}

export function buildAskThreadStarter(question) {
    return panel([text(`### Ask\n${question}`), text('-# Snail is answering in this thread.')]);
}

export function buildAnswer(answer, sources, feedbackId, question) {
    const publicSources = sources.filter((tag) => tag.public).slice(0, 5);
    return panel([
        ...(question ? [text(`${ASK_QUESTION_PREFIX}${question}`)] : []),
        ...splitText(answer, 3500).map(text),
        ...(publicSources.length
            ? [text(`-# Sources: ${publicSources.map((tag) => `\`${tag._id}\``).join(', ')}`)]
            : []),
        text('> -# ⚠️ Snail may be incorrect. This feature is still a work in progress!'),
        {
            type: ComponentType.ActionRow,
            components: [
                button(`${IDS.feedback}${feedbackId}:helpful`, 'Helpful', ButtonStyle.Success),
                button(`${IDS.feedback}${feedbackId}:needsFix`, 'Needs Fix', ButtonStyle.Danger),
            ],
        },
    ]);
}

export function isAskAnswerMessage(message, botUserId) {
    if (!botUserId || message?.author?.id !== botUserId) return false;

    const ratings = new Map();
    visitComponents(message.components, (component) => {
        if (component.type !== ComponentType.Button || !component.customId?.startsWith(IDS.feedback)) return;
        const match = component.customId.slice(IDS.feedback.length).match(/^(.+):(helpful|needsFix)$/);
        if (match) ratings.set(match[2], match[1]);
    });
    return ratings.has('helpful') && ratings.get('helpful') === ratings.get('needsFix');
}

export function extractAskAnswer(message) {
    const parts = [];
    visitComponents(message?.components, (component) => {
        if (component.type !== ComponentType.TextDisplay) return;
        const content = String(component.content ?? '').trim();
        if (
            !content ||
            content.startsWith(ASK_QUESTION_PREFIX) ||
            content.startsWith('-# Sources:') ||
            content.startsWith('> -# ⚠️')
        )
            return;
        parts.push(content);
    });
    return parts.join('\n').trim();
}

export function extractAskQuestion(message) {
    let question = '';
    visitComponents(message?.components, (component) => {
        const content = component.type === ComponentType.TextDisplay ? String(component.content ?? '').trim() : '';
        if (!question && content.startsWith(ASK_QUESTION_PREFIX)) {
            question = content.slice(ASK_QUESTION_PREFIX.length).trim();
        }
    });
    return question;
}

export function disableFeedbackMessage(message, selectedId) {
    const components = disableComponents(message.components ?? []);
    for (const component of components) {
        markSelected(component, selectedId);
    }
    return suppressMentions({ flags: MessageFlags.IsComponentsV2, components });
}

export function buildFeedbackReport({ rating, userId, question, questionMessage, answer, sources, message }) {
    const link = getMessageJumpLink({
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
    });
    const questionLink = questionMessage
        ? getMessageJumpLink({
              guildId: questionMessage.guildId,
              channelId: questionMessage.channelId,
              messageId: questionMessage.id,
          })
        : undefined;
    const report =
        `## Ask Feedback · ${rating === 'helpful' ? 'Helpful' : 'Needs Fix'}\n` +
        `**User:** <@${userId}> (${userId})\n` +
        `**Question:** ${question}\n` +
        (questionLink ? `**Original:** ${questionLink}\n` : '') +
        `**Answer:** ${link}\n` +
        `**Response:** ${answer}\n` +
        `**Resources:** ${sources.length ? sources.map((tag) => `\`${tag._id}\``).join(', ') : 'None'}`;
    return panel(splitText(report, 3500).map(text));
}

export function buildFindResults(result, sessionId, requestedPage = 0) {
    const selected = new Map(result.groups.map((group, index) => [group.tagId, { ...group, rank: index + 1 }]));
    const blocks = result.candidates.map((group, index) => {
        const final = selected.get(group.tagId);
        const hits = group.hits
            .map((hit) => {
                const detail = hit.payload.kind === 'tag_question' ? ` · ${hit.payload.question}` : '';
                return (
                    `- ${hit.payload.kind}: ${hit.score.toFixed(4)} · ` +
                    `${hit.score >= result.threshold ? 'passes' : 'below'} threshold${detail}`
                );
            })
            .join('\n');
        return (
            `### ${index + 1}. ${group.tagId} · ${group.tag.public ? 'Public' : 'Private'}\n` +
            `-# Dense ${group.score.toFixed(4)}` +
            (final
                ? ` · Final #${final.rank} · Rerank ${final.rerankScore?.toFixed(4) ?? 'not used'}`
                : ' · Not selected') +
            `\n` +
            `${group.tag.text.slice(0, 500)}\n${hits}`
        );
    });
    const pages = packFindPages(blocks);
    const page = Math.min(Math.max(Number(requestedPage) || 0, 0), pages.length - 1);

    return panel([
        text(
            `## Knowledge Base Search\n` +
                `**Question:** ${result.question}\n` +
                `**Threshold:** ${result.threshold}\n` +
                `**Terms:** ${result.terms.length ? result.terms.map((term) => `\`${term.id}\``).join(', ') : 'None'}`,
        ),
        separator(),
        text(pages[page]),
        ...(pages.length > 1
            ? [
                  separator(),
                  {
                      type: ComponentType.ActionRow,
                      components: [
                          button(`${IDS.findPage}${sessionId}:${page - 1}`, 'Previous', undefined, page === 0),
                          button(
                              `${IDS.findPage}${sessionId}:${page + 1}`,
                              'Next',
                              undefined,
                              page === pages.length - 1,
                          ),
                      ],
                  },
                  text(`-# Page ${page + 1}/${pages.length}`),
              ]
            : []),
    ]);
}

function panel(components) {
    return suppressMentions({
        flags: MessageFlags.IsComponentsV2,
        components: [{ type: ComponentType.Container, components }],
    });
}

function text(content) {
    return { type: ComponentType.TextDisplay, content };
}

function button(customId, label, style = ButtonStyle.Secondary, disabled = false) {
    return { type: ComponentType.Button, customId, label, style, disabled };
}

function separator() {
    return { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small };
}

function markSelected(component, selectedId) {
    if (component.customId === selectedId) component.style = ButtonStyle.Primary;
    for (const child of component.components ?? []) markSelected(child, selectedId);
    if (component.accessory) markSelected(component.accessory, selectedId);
}

function visitComponents(components, visit) {
    for (const component of components ?? []) {
        visit(component);
        visitComponents(component.components, visit);
        if (component.accessory) visitComponents([component.accessory], visit);
    }
}

function packFindPages(blocks) {
    if (!blocks.length) return ['No matching tags found.'];
    const pages = [];
    let page = '';

    for (const block of blocks) {
        for (const part of splitText(block, 3200)) {
            if (page && page.length + part.length + 2 > 3500) {
                pages.push(page);
                page = '';
            }
            page += `${page ? '\n\n' : ''}${part}`;
        }
    }
    if (page) pages.push(page);
    return pages;
}

function packListPages(entries) {
    if (!entries.length) return ['No entries found.'];
    const pages = [];
    let page = '';
    for (const entry of entries) {
        const addition = `${page ? ', ' : ''}${entry}`;
        if (page && page.length + addition.length > 3400) {
            pages.push(page);
            page = entry;
        } else {
            page += addition;
        }
    }
    if (page) pages.push(page);
    return pages;
}

function splitText(value, limit) {
    const parts = [];
    let remaining = value;
    while (remaining.length > limit) {
        const boundary = Math.max(remaining.lastIndexOf('\n', limit), remaining.lastIndexOf(' ', limit));
        const split = boundary > 0 ? boundary : limit;
        parts.push(remaining.slice(0, split));
        remaining = remaining.slice(split).trimStart();
    }
    if (remaining) parts.push(remaining);
    return parts;
}
