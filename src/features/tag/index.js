import { ApplicationCommandOptionType, ApplicationCommandType, MessageFlags } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { componentsMessage, container, textDisplay } from '../../discord/components.js';
import {
    getFocusedSubcommandOption,
    getSubcommand,
    getSubcommandOption,
    getSubcommandOptionValue
} from '../../discord/utils.js';
import { createTagRepository } from './repository.js';

const TagAutocompleteLimit = 25;
const TagNamePattern = /^[a-z0-9]+$/;

export default function setupTags({ config, databases, services }) {
    const repository = createTagRepository(databases.snail.mongo);
    const tagNameCache = createTagNameCache(repository);

    return {
        routes: [
            createTagRoute({ accentColor: config.colors.ui.warning, repository, tagNameCache }),
            createTagManageRoute({ messageBuilder: services.messageBuilder, repository, tagNameCache })
        ]
    };
}

function createTagRoute({ accentColor, repository, tagNameCache }) {
    return {
        kind: 'command',
        id: 'tag:command',
        command: {
            type: ApplicationCommandType.ChatInput,
            name: 'tag',
            description: 'View tags.',
            options: [
                {
                    name: 'get',
                    description: 'Send a tag.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [tagNameOption({ autocomplete: true })]
                },
                {
                    name: 'list',
                    description: 'List existing tags.',
                    type: ApplicationCommandOptionType.Subcommand
                }
            ]
        },
        autocomplete: (context) => autocompleteTags(context, tagNameCache),
        async handle(context) {
            const subcommand = getSubcommand(context);

            switch (subcommand?.name) {
                case 'get':
                    await sendTag(context, repository);
                    return;
                case 'list':
                    await listTags(context, tagNameCache, accentColor);
                    return;
                default:
                    await context.respond('Choose a valid tag action.', { ephemeral: true });
            }
        }
    };
}

function createTagManageRoute({ messageBuilder, repository, tagNameCache }) {
    return {
        kind: 'command',
        id: 'tag:manage',
        command: {
            type: ApplicationCommandType.ChatInput,
            name: 'tag-manage',
            description: 'Manage tags.',
            staff: true,
            options: [
                {
                    name: 'create',
                    description: 'Create a tag. Omit message to open Message Builder.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        tagNameOption(),
                        {
                            name: 'message',
                            description: 'Plain text to save. Omit to open Message Builder.',
                            type: ApplicationCommandOptionType.String,
                            required: false,
                            min_length: 1
                        }
                    ]
                },
                {
                    name: 'edit',
                    description: 'Edit a tag. Omit message to open Message Builder.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        tagNameOption({ autocomplete: true }),
                        {
                            name: 'message',
                            description: 'Plain text replacement. Omit to open Message Builder.',
                            type: ApplicationCommandOptionType.String,
                            required: false,
                            min_length: 1
                        }
                    ]
                },
                {
                    name: 'delete',
                    description: 'Delete a tag.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [tagNameOption({ autocomplete: true })]
                },
                {
                    name: 'public',
                    description: 'Set whether a tag is public in a channel.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [tagNameOption({ autocomplete: true }), publicOption(), channelOption({ required: false })]
                },
                {
                    name: 'public-default',
                    description: 'Set whether all tags are public by default in a channel.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [publicOption(), channelOption({ required: false })]
                },
                {
                    name: 'public-list',
                    description: 'List one tag across channels, or omit name to list this channel.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        tagNameOption({ autocomplete: true, required: false }),
                        channelOption({ required: false })
                    ]
                }
            ]
        },
        authorize: hasManagerAccess,
        autocomplete: (context) => autocompleteTags(context, tagNameCache),
        async handle(context) {
            const subcommand = getSubcommand(context);

            switch (subcommand?.name) {
                case 'create':
                    await createTag(context, { messageBuilder, repository, tagNameCache });
                    return;
                case 'edit':
                    await editTag(context, { messageBuilder, repository });
                    return;
                case 'delete':
                    await deleteTag(context, { repository, tagNameCache });
                    return;
                case 'public':
                    await setTagPublic(context, repository);
                    return;
                case 'public-default':
                    await setPublicDefault(context, repository);
                    return;
                case 'public-list':
                    await listPublicPolicy(context, repository);
                    return;
                default:
                    await context.respond('Choose a valid tag management action.', { ephemeral: true });
            }
        }
    };
}

async function sendTag(context, repository) {
    const name = getTagName(context);
    if (!name) {
        await invalidTagName(context);
        return;
    }

    const tag = await repository.findTag(name);
    if (!tag) {
        await context.respond('That tag does not exist.', { ephemeral: true });
        return;
    }

    const isPublic = await isTagPublicInChannel(repository, tag, context.channelId);

    await repository.trackTagUse(name);
    await context.respond(prepareTagMessage(tag, { ephemeral: !isPublic }));
}

async function listTags(context, tagNameCache, accentColor) {
    const names = await tagNameCache.get();
    if (!names.length) {
        await context.respond("Oh no! I don't have any tags.", { ephemeral: true });
        return;
    }

    await context.respond(componentsMessage(renderTagList(names, accentColor), { ephemeral: true }));
}

async function createTag(context, { messageBuilder, repository, tagNameCache }) {
    const name = getTagName(context);
    if (!name) {
        await invalidTagName(context);
        return;
    }

    const existing = await repository.findTag(name);
    if (existing) {
        await context.respond('That tag already exists.', { ephemeral: true });
        return;
    }

    const message = getSubcommandOptionValue(context, 'message').trim();
    if (message) {
        await repository.createTag({
            createdBy: context.userId,
            message: createPlainTextTagMessage(message),
            name
        });
        tagNameCache.add(name);
        await context.respond(`Created the tag \`${name}\`.`, { ephemeral: true });
        return;
    }

    await messageBuilder.start(context, {
        authorize: hasManagerAccess,
        allowMentions: false,
        label: `Create tag \`${name}\``,
        submitError: `Could not create the tag \`${name}\`.`,
        async submit({ context: submitContext, message: builtMessage }) {
            const current = await repository.findTag(name);
            if (current) {
                throw new Error('Tag already exists.');
            }

            await repository.createTag({
                createdBy: submitContext.userId,
                message: builtMessage,
                name
            });
            tagNameCache.add(name);

            return `Created the tag \`${name}\`.`;
        },
        submitLabel: 'Create Tag'
    });
}

async function editTag(context, { messageBuilder, repository }) {
    const name = getTagName(context);
    if (!name) {
        await invalidTagName(context);
        return;
    }

    const tag = await repository.findTag(name);
    if (!tag) {
        await context.respond('That tag does not exist.', { ephemeral: true });
        return;
    }

    const message = getSubcommandOptionValue(context, 'message').trim();
    if (message) {
        await repository.updateTag({
            message: createPlainTextTagMessage(message),
            name,
            updatedBy: context.userId
        });
        await context.respond(`Updated the tag \`${name}\`.`, { ephemeral: true });
        return;
    }

    await messageBuilder.start(context, {
        authorize: hasManagerAccess,
        allowMentions: false,
        label: `Edit tag \`${name}\``,
        sourceMessage: getTagMessage(tag),
        submitError: `Could not update the tag \`${name}\`.`,
        async submit({ context: submitContext, message: builtMessage }) {
            const updated = await repository.updateTag({
                message: builtMessage,
                name,
                updatedBy: submitContext.userId
            });
            if (!updated) {
                throw new Error('Tag does not exist.');
            }

            return `Updated the tag \`${name}\`.`;
        },
        submitLabel: 'Update Tag'
    });
}

async function deleteTag(context, { repository, tagNameCache }) {
    const name = getTagName(context);
    if (!name) {
        await invalidTagName(context);
        return;
    }

    const deleted = await repository.deleteTag(name);
    if (!deleted) {
        await context.respond('That tag does not exist.', { ephemeral: true });
        return;
    }

    tagNameCache.delete(name);
    await context.respond(`Deleted the tag \`${name}\`.`, { ephemeral: true });
}

async function setTagPublic(context, repository) {
    const name = getTagName(context);
    if (!name) {
        await invalidTagName(context);
        return;
    }

    const channelId = getChannelId(context);
    const isPublic = getBooleanOption(context, 'public');
    if (typeof isPublic !== 'boolean') {
        await context.respond('Choose whether the tag should be public.', { ephemeral: true });
        return;
    }

    const updated = await repository.setTagPublic({ channelId, isPublic, name });
    if (!updated) {
        await context.respond('That tag does not exist.', { ephemeral: true });
        return;
    }

    const channel = await repository.getChannelPolicy(channelId);
    if (isPublic) {
        await context.respond(
            channel?.tagsPublicByDefault
                ? `The tag \`${name}\` now has a tag-specific public setting in <#${channelId}>. All tags are already public by default there, so this setting only matters if the channel default is turned off later.`
                : `The tag \`${name}\` will now be public in <#${channelId}>.`,
            { ephemeral: true }
        );
        return;
    }

    await context.respond(
        channel?.tagsPublicByDefault
            ? `Removed the tag-specific public setting for \`${name}\` in <#${channelId}>, but all tags are still public by default in that channel. Use \`/tag-manage public-default public:false\` there to make tags private by default.`
            : `The tag \`${name}\` no longer has a public setting in <#${channelId}>. It is private there now.`,
        { ephemeral: true }
    );
}

async function setPublicDefault(context, repository) {
    const channelId = getChannelId(context);
    const isPublic = getBooleanOption(context, 'public');
    if (typeof isPublic !== 'boolean') {
        await context.respond('Choose whether tags should be public by default.', { ephemeral: true });
        return;
    }

    await repository.setChannelDefault({ channelId, isPublic });
    await context.respond(
        isPublic
            ? `All tags will now be public by default in <#${channelId}>.`
            : `All tags are no longer public by default in <#${channelId}>. Tags with their own public setting will still be public there.`,
        { ephemeral: true }
    );
}

async function listPublicPolicy(context, repository) {
    const name = getOptionalTagName(context);
    if (name === false) {
        await invalidTagName(context);
        return;
    }

    if (name) {
        const tag = await repository.findTag(name);
        if (!tag) {
            await context.respond('That tag does not exist.', { ephemeral: true });
            return;
        }

        const channels = tag.publicChannelIds ?? [];
        await context.respond(
            channels.length
                ? `The tag \`${name}\` has tag-specific public settings in ${channels.map((channelId) => `<#${channelId}>`).join(' ')}. It may also be public in channels where all tags are public by default.`
                : `The tag \`${name}\` has no tag-specific public channels. It may still be public in channels where all tags are public by default.`,
            { ephemeral: true }
        );
        return;
    }

    const channelId = getChannelId(context);
    const channel = await repository.getChannelPolicy(channelId);
    const publicTagNames = await repository.getPublicTagsInChannel(channelId);
    const tagList = publicTagNames.length ? publicTagNames.map((tagName) => `\`${tagName}\``).join(' ') : 'None.';
    const defaultText = channel?.tagsPublicByDefault
        ? `All tags are public by default in <#${channelId}>. Tag-specific public settings are listed below, but the channel default already makes every tag public.`
        : `All tags are not public by default in <#${channelId}>. Only the tag-specific public settings below are public here.`;

    await context.respond(`${defaultText}\nTag-specific public settings: ${tagList}`, { ephemeral: true });
}

async function isTagPublicInChannel(repository, tag, channelId) {
    if (tag.publicChannelIds?.includes(channelId)) {
        return true;
    }

    const channel = await repository.getChannelPolicy(channelId);

    return Boolean(channel?.tagsPublicByDefault);
}

function createTagNameCache(repository) {
    let names;

    return {
        add(name) {
            if (names) {
                names = sortTagNames([...new Set([...names, name])]);
            }
        },
        delete(name) {
            if (names) {
                names = names.filter((existing) => existing !== name);
            }
        },
        async get() {
            names ??= sortTagNames(await repository.listTagNames());

            return names;
        }
    };
}

function renderTagList(names, accentColor) {
    return [
        container([textDisplay(`## Tags (${names.length})\n${names.map((name) => `\`${name}\``).join(' ')}`)], {
            accentColor
        })
    ];
}

function prepareTagMessage(tag, { ephemeral }) {
    const message = getTagMessage(tag);
    const flags = message.flags ?? 0;

    return {
        ...message,
        allowed_mentions: { parse: [] },
        flags: ephemeral ? flags | MessageFlags.Ephemeral : flags & ~MessageFlags.Ephemeral
    };
}

function getTagMessage(tag) {
    if (tag.message) {
        return tag.message;
    }

    if (typeof tag.data === 'string' && tag.data) {
        return {
            content: tag.data
        };
    }
}

async function autocompleteTags(context, tagNameCache) {
    const focused = getFocusedSubcommandOption(context);
    const value = String(focused?.value ?? '').toLowerCase();
    const names = await tagNameCache.get();

    return names
        .filter((name) => name.includes(value))
        .slice(0, TagAutocompleteLimit)
        .map((name) => ({ name, value: name }));
}

function createPlainTextTagMessage(content) {
    return componentsMessage([textDisplay(content.trim())]);
}

function getTagName(context) {
    const name = normalizeTagName(getSubcommandOptionValue(context, 'name'));

    return isValidTagName(name) ? name : undefined;
}

function getOptionalTagName(context) {
    const rawName = getSubcommandOptionValue(context, 'name');
    if (!rawName) {
        return undefined;
    }

    const name = normalizeTagName(rawName);

    return isValidTagName(name) ? name : false;
}

function getChannelId(context) {
    return getSubcommandOptionValue(context, 'channel') || context.channelId;
}

function getBooleanOption(context, name) {
    return getSubcommandOption(context, name)?.value;
}

function tagNameOption({ autocomplete = false, required = true } = {}) {
    return {
        name: 'name',
        description: 'Tag name.',
        type: ApplicationCommandOptionType.String,
        required,
        autocomplete
    };
}

function publicOption() {
    return {
        name: 'public',
        description: 'True makes it public. False makes it private.',
        type: ApplicationCommandOptionType.Boolean,
        required: true
    };
}

function channelOption({ required }) {
    return {
        name: 'channel',
        description: 'Channel to configure. Omit to use the current channel.',
        type: ApplicationCommandOptionType.Channel,
        required
    };
}

async function invalidTagName(context) {
    await context.respond('Use only lowercase letters and numbers for tag names.', { ephemeral: true });
}

function isValidTagName(name) {
    return TagNamePattern.test(name);
}

function normalizeTagName(value) {
    return String(value ?? '').toLowerCase();
}

function sortTagNames(names) {
    return [...names].sort((left, right) => left.localeCompare(right));
}
