import { randomUUID } from 'node:crypto';
import { ApplicationCommandOptionType, ApplicationCommandType, MessageFlags } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { disableComponents, getCustomIdSuffix, getInteractionUser } from '../../discord/interactions.js';
import { normalizeMessage, suppressMentions } from '../../discord/messages.js';
import { buildIdentifierBatchResponse, IDENTIFIERS_MAX_LENGTH, parseIdentifiers } from '../../utils/identifiers.js';
import { normalizeTagId, TAG_ID_MAX_LENGTH } from '../../utils/tags.js';
import {
    buildFindResults,
    buildPrivateTagModal,
    buildQuestions,
    buildQuestionsModal,
    buildTagList,
    IDS,
    readPrivateTagText,
    readQuestions,
} from './render.js';
import { normalizeTermId, TERM_ID_MAX_LENGTH } from './terms.js';

const COMMAND = {
    type: ApplicationCommandType.ChatInput,
    name: 'knowledge-base',
    description: 'Manage Snail knowledge.',
    options: [
        subcommand('tag', 'Preview a private tag.', [tagOption('Private tag name.')]),
        subcommand('list', 'List private tags.'),
        subcommand('set', 'Create or edit a private tag.', [tagOption('Tag name.')]),
        subcommand('delete', 'Delete one or more private tags.', [tagIdsOption('Tag names separated by whitespace.')]),
        subcommand('find', 'Find tags related to a question.', [
            stringOption('question', 'Question to search for.', false, 1, 500),
        ]),
        subcommand('questions', 'View and edit retrieval questions.', [tagOption('Tag name.')]),
        subcommand('exclude', 'Exclude one or more tags from retrieval.', [
            tagIdsOption('Tag names separated by whitespace.'),
        ]),
        subcommand('include', 'Include one or more tags in retrieval.', [
            tagIdsOption('Tag names separated by whitespace.'),
        ]),
        subcommand('excluded', 'List excluded tags.'),
        {
            type: ApplicationCommandOptionType.SubcommandGroup,
            name: 'term',
            description: 'Manage OwO-specific terms.',
            options: [
                subcommand('set', 'Add or update a term.', [
                    stringOption('id', 'Lowercase words joined with underscores.', false, 1, TERM_ID_MAX_LENGTH),
                    stringOption('meaning', 'Short definition.', false, 1, 500),
                ]),
                subcommand('delete', 'Delete one or more terms.', [
                    stringOption('id', 'Term IDs separated by whitespace.', true, 1, IDENTIFIERS_MAX_LENGTH),
                ]),
                subcommand('list', 'List terms.'),
            ],
        },
    ],
};

const SESSION_LIFETIME = 15 * 60_000;

export function createKnowledgeBaseManagement({
    Tag,
    KnowledgeTerm,
    knowledge,
    tagSync,
    tags,
    terms,
    log,
    searchMissing,
}) {
    const findSessions = new Map();
    const listSessions = new Map();

    return {
        initialize,
        command: {
            definition: COMMAND,
            staff: true,
            availableWhenDisabled: true,
            authorize: hasManagerAccess,
            autocomplete,
            handle,
        },
        components: [
            managerPrefix(IDS.questionsEdit, editQuestions, searchMissing),
            managerPrefix(IDS.questionsRegenerate, regenerateQuestions, searchMissing),
            managerPrefix(IDS.findPage, changeFindPage),
            managerPrefix(IDS.tagListPage, changeTagListPage),
        ],
        modals: [
            managerPrefix(IDS.privateTagModal, savePrivateTag),
            managerPrefix(IDS.questionsModal, saveQuestions, searchMissing),
        ],
    };

    async function initialize() {
        if (!Tag) return;

        const [storedTags, storedTerms] = await Promise.all([
            Tag.find({}).sort({ _id: 1 }).lean(),
            KnowledgeTerm.find({}).sort({ _id: 1 }).lean(),
        ]);
        for (const tag of storedTags) tags.set(tag._id, tag);
        for (const term of storedTerms) terms.set(term._id, term.meaning);
    }

    async function handle(context) {
        const { group, action } = getAction(context.interaction);
        if (group === 'term') {
            await handleTerm(context, action);
            return;
        }

        if (action === 'list') {
            await context.respond(
                createTagList(
                    getTagIds((tag) => !tag.public),
                    'Private Tags',
                ),
                {
                    ephemeral: true,
                },
            );
            return;
        }
        if (action === 'excluded') {
            await context.respond(
                createTagList(
                    getTagIds((tag) => tag.knowledgeBase?.excluded === true),
                    'Excluded Tags',
                ),
                { ephemeral: true },
            );
            return;
        }
        if (action === 'find') {
            if (!(await requireKnowledge(context))) return;
            await context.defer({ ephemeral: true });
            const result = await knowledge.find(getOption(context.interaction, 'question'));
            const sessionId = createSession(findSessions, result);
            await context.editResponse(buildFindResults(result, sessionId));
            return;
        }
        if (action === 'exclude' || action === 'include') {
            await setTagExclusions(context, action === 'exclude');
            return;
        }
        if (action === 'delete') {
            await deletePrivateTags(context);
            return;
        }

        const tagId = normalizeTagId(getOption(context.interaction, 'name'));
        if (!tagId) {
            await context.respond(`Tag names may contain 1-${TAG_ID_MAX_LENGTH} lowercase letters only.`, {
                ephemeral: true,
            });
            return;
        }
        if (action === 'questions') {
            if (!(await requireKnowledge(context))) return;
            const editor = await knowledge.getQuestionEditor(tagId);
            await context.respond(editor ? buildQuestions(editor) : 'That tag does not exist.', { ephemeral: true });
            return;
        }
        const tag = tags.get(tagId);
        if (action === 'tag') {
            await context.respond(tag && !tag.public ? tag.message : 'That private tag does not exist.', {
                ephemeral: true,
            });
        } else if (action === 'set') {
            if (tag?.public) {
                await context.respond(`\`${tagId}\` is an existing tag. Use \`/tag-manage set\` instead.`, {
                    ephemeral: true,
                });
            } else {
                await context.openModal(buildPrivateTagModal(tagId, tag?.text));
            }
        }
    }

    async function setTagExclusions(context, excluded) {
        const { identifiers: tagIds, invalid } = parseIdentifiers(
            getOption(context.interaction, 'name'),
            normalizeTagId,
        );
        const changed = [];
        const unchanged = [];
        const missing = [];

        for (const tagId of tagIds) {
            const existing = tags.get(tagId);
            if (!existing) {
                missing.push(tagId);
            } else if ((existing.knowledgeBase?.excluded === true) === excluded) {
                unchanged.push(tagId);
            } else {
                changed.push({
                    ...existing,
                    knowledgeBase: { ...existing.knowledgeBase, excluded },
                });
            }
        }

        if (changed.length) {
            await context.defer({ ephemeral: true });
            const changedIds = changed.map((tag) => tag._id);
            await Tag.updateMany({ _id: { $in: changedIds } }, { $set: { 'knowledgeBase.excluded': excluded } });
            for (const tag of changed) tags.set(tag._id, tag);
            await synchronizeTags('set', changed);
            log.info(`${excluded ? 'Excluded' : 'Included'} Knowledge Base tags`, {
                tagIds: changedIds,
                userId: getInteractionUser(context.interaction)?.id,
            });
        }

        const response = buildIdentifierBatchResponse([
            [excluded ? 'Excluded' : 'Included', changed.map((tag) => tag._id)],
            [excluded ? 'Already excluded' : 'Already included', unchanged],
            [
                'Not indexed (no searchable text)',
                excluded ? [] : tagIds.filter((tagId) => tags.has(tagId) && !tags.get(tagId).text),
            ],
            ['Not found', missing],
            ['Invalid', invalid],
        ]);
        if (changed.length) await context.editResponse(response);
        else await context.respond(response, { ephemeral: true });
    }

    async function deletePrivateTags(context) {
        const { identifiers: tagIds, invalid } = parseIdentifiers(
            getOption(context.interaction, 'name'),
            normalizeTagId,
        );
        const deleted = [];
        const missing = [];

        for (const tagId of tagIds) {
            const tag = tags.get(tagId);
            if (tag && !tag.public) deleted.push(tag);
            else missing.push(tagId);
        }

        if (deleted.length) {
            await context.defer({ ephemeral: true });
            const deletedIds = deleted.map((tag) => tag._id);
            await Tag.deleteMany({ _id: { $in: deletedIds }, public: false });
            for (const tagId of deletedIds) tags.delete(tagId);
            await synchronizeTags('delete', deleted);
            log.info('Deleted private tags', {
                tagIds: deletedIds,
                userId: getInteractionUser(context.interaction)?.id,
            });
        }

        const response = buildIdentifierBatchResponse([
            ['Deleted', deleted.map((tag) => tag._id)],
            ['Not found', missing],
            ['Invalid', invalid],
        ]);
        if (deleted.length) await context.editResponse(response);
        else await context.respond(response, { ephemeral: true });
    }

    async function handleTerm(context, action) {
        if (action === 'list') {
            const entries = [...terms]
                .toSorted(([left], [right]) => left.localeCompare(right))
                .map(([id, meaning]) => `${id} — ${meaning}`);
            await context.respond(createTagList(entries, 'Knowledge Terms'), { ephemeral: true });
            return;
        }

        if (action === 'delete') {
            const { identifiers: termIds, invalid } = parseIdentifiers(
                getOption(context.interaction, 'id'),
                normalizeTermId,
            );
            const deleted = termIds.filter((termId) => terms.has(termId));
            const missing = termIds.filter((termId) => !terms.has(termId));

            if (deleted.length) {
                await context.defer({ ephemeral: true });
                await KnowledgeTerm.deleteMany({ _id: { $in: deleted } });
                for (const termId of deleted) terms.delete(termId);
                log.info('Deleted Knowledge Base terms', {
                    termIds: deleted,
                    userId: getInteractionUser(context.interaction)?.id,
                });
            }

            const response = buildIdentifierBatchResponse([
                ['Deleted', deleted],
                ['Not found', missing],
                ['Invalid', invalid],
            ]);
            if (deleted.length) await context.editResponse(response);
            else await context.respond(response, { ephemeral: true });
            return;
        }

        const termId = normalizeTermId(getOption(context.interaction, 'id'));
        if (!termId) {
            await context.respond(
                `Term IDs may contain 1-${TERM_ID_MAX_LENGTH} characters, using lowercase words separated by underscores.`,
                { ephemeral: true },
            );
            return;
        }
        const meaning = String(getOption(context.interaction, 'meaning') ?? '').trim();
        await context.defer({ ephemeral: true });
        await KnowledgeTerm.updateOne({ _id: termId }, { $set: { meaning } }, { upsert: true });
        terms.set(termId, meaning);
        log.info('Set Knowledge Base term', { termId, userId: getInteractionUser(context.interaction)?.id });
        await context.editResponse(`Set \`${termId}\` to “${meaning}”.`);
    }

    async function savePrivateTag(context) {
        const tagId = getCustomIdSuffix(context.interaction, IDS.privateTagModal);
        const text = readPrivateTagText(context.interaction);
        if (!text) {
            await context.respond('Private tag text cannot be empty.', { ephemeral: true });
            return;
        }
        await context.defer({ ephemeral: true });
        const existing = tags.get(tagId);
        if (existing?.public) {
            await context.editResponse(
                `A public tag named \`${tagId}\` already exists. Use \`/tag-manage set\` instead.`,
            );
            return;
        }
        const tag = {
            _id: tagId,
            message: normalizeMessage(text),
            text,
            public: false,
            knowledgeBase: existing?.knowledgeBase ?? {},
        };
        const { _id, ...values } = tag;
        await Tag.updateOne({ _id }, { $set: values }, { upsert: true });
        tags.set(tagId, tag);
        await synchronizeTags('set', [tag]);
        log.info('Set private tag', { tagId, userId: getInteractionUser(context.interaction)?.id });
        await context.editResponse(`Saved private tag \`${tagId}\`.`, { ephemeral: true });
    }

    async function synchronizeTags(type, changedTags) {
        if (!tagSync || !changedTags.length) return;

        try {
            if (type === 'delete') await tagSync.deleteTags(changedTags.map((tag) => tag._id));
            else await tagSync.syncTags(changedTags);
        } catch (error) {
            log.error('Tags changed but Knowledge Base synchronization failed', {
                error,
                tagIds: changedTags.map((tag) => tag._id),
                type,
            });
        }
    }

    async function editQuestions(context) {
        const tagId = getCustomIdSuffix(context.interaction, IDS.questionsEdit);
        const editor = await knowledge.getQuestionEditor(tagId);
        if (!editor) {
            await context.respond('That tag no longer exists.', { ephemeral: true });
            return;
        }
        await context.openModal(buildQuestionsModal(editor));
    }

    async function saveQuestions(context) {
        const tagId = getCustomIdSuffix(context.interaction, IDS.questionsModal);
        await context.deferUpdate();
        const editor = await knowledge.updateQuestions(tagId, readQuestions(context.interaction));
        if (!editor) {
            await context.respond('That tag no longer exists.', { ephemeral: true });
            return;
        }
        log.info('Updated Knowledge Base retrieval questions', {
            tagId,
            userId: getInteractionUser(context.interaction)?.id,
        });
        await context.editResponse(buildQuestions(editor));
    }

    async function regenerateQuestions(context) {
        const tagId = getCustomIdSuffix(context.interaction, IDS.questionsRegenerate);
        await context.deferUpdate();
        const editor = await knowledge.regenerateQuestions(tagId);
        if (!editor) {
            await context.respond('That tag no longer exists.', { ephemeral: true });
            return;
        }
        log.info('Regenerated Knowledge Base retrieval questions', {
            tagId,
            userId: getInteractionUser(context.interaction)?.id,
        });
        await context.editResponse(buildQuestions(editor));
    }

    async function changeFindPage(context) {
        const [sessionId, page] = getCustomIdSuffix(context.interaction, IDS.findPage).split(':');
        const result = findSessions.get(sessionId);
        if (!result) {
            await expireSession(context, 'That search result has expired.');
            return;
        }
        await context.update(buildFindResults(result, sessionId, page));
    }

    async function changeTagListPage(context) {
        const [sessionId, page] = getCustomIdSuffix(context.interaction, IDS.tagListPage).split(':');
        const session = listSessions.get(sessionId);
        if (!session) {
            await expireSession(context, 'That tag list has expired.');
            return;
        }
        await context.update(buildTagList(session.entries, session.title, sessionId, page));
    }

    function createTagList(entries, title) {
        const sessionId = createSession(listSessions, { entries, title });
        return buildTagList(entries, title, sessionId);
    }

    function autocomplete(context) {
        const focused = getFocusedOption(context.interaction);
        const input = String(focused?.value ?? '');
        if (/\s/.test(input)) return [];

        if (focused?.name === 'id') {
            return [...terms.keys()]
                .filter((id) => id.includes(input.toLowerCase()))
                .toSorted()
                .slice(0, 25)
                .map((id) => ({ name: id, value: id }));
        }

        const value = input.toLowerCase();
        const { action } = getAction(context.interaction);
        const public_ = ['tag', 'set', 'delete'].includes(action) ? false : undefined;
        return [...tags]
            .filter(([tagId, tag]) => tagId.includes(value) && (public_ === undefined || tag.public === public_))
            .map(([tagId]) => tagId)
            .toSorted()
            .slice(0, 25)
            .map((tagId) => ({ name: tagId, value: tagId }));
    }

    function getTagIds(predicate) {
        return [...tags]
            .filter(([, tag]) => predicate(tag))
            .map(([tagId]) => tagId)
            .toSorted();
    }

    async function expireSession(context, message) {
        const components = disableComponents(context.interaction.message?.components ?? []);
        if (components.length) {
            await context.update(suppressMentions({ flags: MessageFlags.IsComponentsV2, components }));
        }
        await context.respond(message, { ephemeral: true });
    }

    async function requireKnowledge(context) {
        if (knowledge) return true;
        await context.respond('Knowledge Base search is currently unavailable.', { ephemeral: true });
        return false;
    }
}

function managerPrefix(prefix, handle, missing = []) {
    return { prefix, missing, availableWhenDisabled: true, authorize: hasManagerAccess, handle };
}

function subcommand(name, description, options = []) {
    return { type: ApplicationCommandOptionType.Subcommand, name, description, options };
}

function tagOption(description) {
    return stringOption('name', description, true, 1, TAG_ID_MAX_LENGTH);
}

function tagIdsOption(description) {
    return stringOption('name', description, true, 1, IDENTIFIERS_MAX_LENGTH);
}

function stringOption(name, description, autocomplete = false, minLength, maxLength) {
    return {
        type: ApplicationCommandOptionType.String,
        name,
        description,
        required: true,
        autocomplete,
        ...(minLength === undefined ? {} : { minLength }),
        ...(maxLength === undefined ? {} : { maxLength }),
    };
}

function getAction(interaction) {
    const first = interaction.data.options?.[0];
    const grouped = first?.type === ApplicationCommandOptionType.SubcommandGroup;
    const action = grouped ? first.options?.[0]?.name : first?.name;
    return { group: grouped ? first.name : undefined, action };
}

function createSession(sessions, value) {
    const id = randomUUID();
    sessions.set(id, value);
    setTimeout(() => sessions.delete(id), SESSION_LIFETIME);
    return id;
}

function getOption(interaction, name) {
    return findOption(interaction.data.options ?? [], (option) => option.name === name)?.value;
}

function getFocusedOption(interaction) {
    return findOption(interaction.data.options ?? [], (option) => option.focused === true);
}

function findOption(options, predicate) {
    for (const option of options) {
        if (predicate(option)) return option;
        const nested = findOption(option.options ?? [], predicate);
        if (nested) return nested;
    }
}
