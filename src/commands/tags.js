import { ApplicationCommandOptionType, ApplicationCommandType } from 'discord-api-types/v10';
import { hasManagerAccess } from '../discord/auth.js';
import { getInteractionUser } from '../discord/interactions.js';
import { buildIdentifierBatchResponse, IDENTIFIERS_MAX_LENGTH, parseIdentifiers } from '../utils/identifiers.js';
import { extractMessageText, normalizeTagId, TAG_ID_MAX_LENGTH } from '../utils/tags.js';

const MAX_TEXT_LENGTH = 4_000;

const TAG_COMMAND = {
    type: ApplicationCommandType.ChatInput,
    name: 'tag',
    description: 'View Snail tags.',
    options: [subcommand('get', 'View a tag.', [stringOption('name', 'Tag name.')]), subcommand('list', 'List tags.')],
};

const TAG_MANAGE_COMMAND = {
    type: ApplicationCommandType.ChatInput,
    name: 'tag-manage',
    description: 'Manage Snail tags.',
    options: [
        subcommand('set', 'Create or edit a tag.', [stringOption('name', 'Tag name.')]),
        subcommand('delete', 'Delete one or more tags.', [
            stringOption('name', 'Tag names separated by whitespace.', IDENTIFIERS_MAX_LENGTH),
        ]),
    ],
};

/**
 * @param {import('../packages.js').PackageContext & {
 *     tags: Map<string, object>,
 *     tagSync: import('../packages.js').KnowledgeBaseTagSync | undefined,
 * }} context
 * @returns {import('../packages.js').Package}
 */
export default function setup({ logging, messageBuilder, services, tags, tagSync }) {
    const log = logging.createLogger('tags');
    const Tag = services.snail.mongo?.Tag;
    const missing = Tag ? [] : ['Snail Mongo'];

    return {
        name: 'Tags',
        missing,
        commands: [
            { definition: TAG_COMMAND, autocomplete, handle: handleTag },
            {
                definition: TAG_MANAGE_COMMAND,
                staff: true,
                authorize: hasManagerAccess,
                autocomplete,
                handle: handleTagManage,
            },
        ],
    };

    async function handleTag(context) {
        if (getSubcommand(context.interaction) === 'list') {
            const names = [...tags]
                .filter(([, tag]) => tag.public)
                .map(([tagId]) => tagId)
                .toSorted();
            for (const message of buildTagLists(names)) {
                await context.respond(message, { ephemeral: true });
            }
            return;
        }

        const tagId = normalizeTagId(getOption(context.interaction, 'name'));
        const tag = tags.get(tagId);
        if (!tag?.public) {
            await context.respond('That tag does not exist.', { ephemeral: true });
            return;
        }
        await context.respond(tag.message);
    }

    async function handleTagManage(context) {
        const subcommand = getSubcommand(context.interaction);

        if (subcommand === 'delete') {
            const { identifiers: tagIds, invalid } = parseIdentifiers(
                getOption(context.interaction, 'name'),
                normalizeTagId,
            );
            const deleted = [];
            const missing = [];

            for (const tagId of tagIds) {
                const tag = tags.get(tagId);
                if (tag?.public) deleted.push(tagId);
                else missing.push(tagId);
            }

            if (deleted.length) {
                await context.defer({ ephemeral: true });
                await Tag.deleteMany({ _id: { $in: deleted }, public: true });
                for (const tagId of deleted) tags.delete(tagId);
                await deleteKnowledgeBaseTags(deleted);
                log.info('Deleted public tags', {
                    tagIds: deleted,
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

        const tagId = normalizeTagId(getOption(context.interaction, 'name'));
        if (!tagId) {
            await context.respond(`Tag names may contain 1-${TAG_ID_MAX_LENGTH} lowercase letters only.`, {
                ephemeral: true,
            });
            return;
        }

        const existing = tags.get(tagId);
        if (existing && !existing.public) {
            await context.respond('That tag name is unavailable.', { ephemeral: true });
            return;
        }

        await messageBuilder.start(context, {
            authorize: hasManagerAccess,
            allowMentions: false,
            title: `Public Tag: ${tagId}`,
            submitLabel: 'Save Tag',
            components: existing?.message?.components ?? [],
            async submit(message) {
                const current = tags.get(tagId);
                if (current && !current.public) {
                    return { ok: false, message: 'That tag name is now unavailable.' };
                }
                const text = extractMessageText(message);
                const tag = {
                    _id: tagId,
                    message,
                    text,
                    public: true,
                    knowledgeBase: current?.knowledgeBase ?? {},
                };
                const { _id, ...values } = tag;
                await Tag.updateOne({ _id }, { $set: values }, { upsert: true });
                tags.set(_id, tag);
                await synchronizeKnowledgeBase(tag);
                log.info('Set public tag', { tagId, userId: getInteractionUser(context.interaction)?.id });
                return {
                    ok: true,
                    message: `Saved tag \`${tagId}\`.`,
                };
            },
        });
    }

    async function autocomplete(context) {
        const input = String(getFocusedOption(context.interaction)?.value ?? '');
        if (/\s/.test(input)) return [];
        const value = input.toLowerCase();
        return [...tags]
            .filter(([tagId, tag]) => tag.public && tagId.includes(value))
            .map(([tagId]) => tagId)
            .toSorted()
            .slice(0, 25)
            .map((tagId) => ({ name: tagId, value: tagId }));
    }

    async function synchronizeKnowledgeBase(tag) {
        if (!tagSync) return;

        try {
            await tagSync.syncTags([tag]);
        } catch (error) {
            log.error('Tag changed but Knowledge Base synchronization failed', {
                error,
                tagId: tag._id,
                type: 'set',
            });
        }
    }

    async function deleteKnowledgeBaseTags(tagIds) {
        if (!tagSync) return;

        try {
            await tagSync.deleteTags(tagIds);
        } catch (error) {
            log.error('Tags deleted but Knowledge Base synchronization failed', {
                error,
                tagIds,
                type: 'delete',
            });
        }
    }
}

function buildTagLists(tagIds) {
    if (!tagIds.length) return ['## Tags\nNo tags found.'];

    const messages = [];
    let content = '## Tags\n';

    for (const tagId of tagIds) {
        const entry = `\`${tagId}\``;
        const addition = `${content.endsWith('\n') ? '' : ', '}${entry}`;

        if (content.length + addition.length > MAX_TEXT_LENGTH) {
            messages.push(content);
            content = `## Tags (continued)\n${entry}`;
        } else {
            content += addition;
        }
    }

    messages.push(content);
    return messages;
}

function subcommand(name, description, options = []) {
    return { type: ApplicationCommandOptionType.Subcommand, name, description, options };
}

function stringOption(name, description, maxLength = TAG_ID_MAX_LENGTH) {
    return {
        type: ApplicationCommandOptionType.String,
        name,
        description,
        required: true,
        autocomplete: true,
        minLength: 1,
        maxLength,
    };
}

function getSubcommand(interaction) {
    return interaction.data.options?.[0]?.name;
}

function getOption(interaction, name) {
    return interaction.data.options?.[0]?.options?.find((option) => option.name === name)?.value;
}

function getFocusedOption(interaction) {
    return interaction.data.options?.[0]?.options?.find((option) => option.focused === true);
}
