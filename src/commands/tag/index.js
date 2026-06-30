import { ApplicationCommandOptionType } from 'discord-api-types/v10';
import {
    accentContainer,
    ephemeralComponentsMessage,
    ephemeralText,
    textDisplay
} from '../../systems/discord/components.js';
import { OpenModes, validateRenderableDraft } from '../../systems/message-builder/index.js';
import { buildCompiledMessage } from '../../systems/message-builder/render.js';
import { auth, getCommandOptions, getOptionValue, getSubcommand } from '../../utils.js';

const TagNamePattern = /^[a-z0-9]+$/;
const AllTags = 'all';
const TagAutocompleteLimit = 25;

export function createTagCommands({ config, databases, messageBuilder }) {
    if (!messageBuilder) {
        throw new Error('createTagCommands requires a Message Builder system.');
    }

    const tagNameCache = createTagNameCache(databases);

    return [
        createTagCommand({ accentColor: config.colors.yellow, databases, tagNameCache }),
        createTagManageCommand({
            databases,
            messageBuilder,
            tagNameCache
        })
    ];
}

function createTagNameCache(databases) {
    let names;

    return {
        async get() {
            if (names) {
                return names;
            }

            const tags = await databases.snail.mongo.Tag.find({}, { _id: 1 }).sort({ _id: 1 }).lean();
            names = sortTagNames(tags.map((tag) => tag._id));

            return names;
        },
        add(name) {
            if (!names) {
                return;
            }

            names = sortTagNames([...new Set([...names, name])]);
        },
        delete(name) {
            if (!names) {
                return;
            }

            names = names.filter((existing) => existing !== name);
        }
    };
}

function createTagCommand({ accentColor, databases, tagNameCache }) {
    return {
        definition: {
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
            switch (getSubcommand(context.data)?.name) {
                case 'get':
                    await sendTag(context, databases);
                    return;
                case 'list':
                    await listTags(context, tagNameCache, accentColor);
                    return;
                default:
                    await context.respond(ephemeralText('Choose a valid tag action.'));
            }
        }
    };
}

function createTagManageCommand({ databases, messageBuilder, tagNameCache }) {
    return {
        auth: auth.manager,
        staff: true,
        definition: {
            name: 'tag-manage',
            description: 'Manage tags.',
            options: [
                {
                    name: 'create',
                    description: 'Create a tag. Leave message blank to open Message Builder.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        tagNameOption(),
                        {
                            name: 'message',
                            description: 'Plain text to save. Leave blank to open Message Builder.',
                            type: ApplicationCommandOptionType.String,
                            required: false
                        }
                    ]
                },
                {
                    name: 'edit',
                    description: 'Edit a tag. Leave message blank to open Message Builder.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        tagNameOption({ autocomplete: true }),
                        {
                            name: 'message',
                            description: 'Plain text replacement. Leave blank to open Message Builder.',
                            type: ApplicationCommandOptionType.String,
                            required: false
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
                    description: 'Set whether a tag is public. Omit channel to use the current channel.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        tagNameOption({ allowAll: true, autocomplete: true }),
                        {
                            name: 'public',
                            description: 'True makes it public. False makes it private.',
                            type: ApplicationCommandOptionType.Boolean,
                            required: true
                        },
                        channelOption({
                            description: 'Channel to configure. Omit to use the current channel.',
                            required: false
                        })
                    ]
                },
                {
                    name: 'public-list',
                    description: 'List public channel settings for a tag, or all public tags in this channel.',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [tagNameOption({ allowAll: true, autocomplete: true })]
                }
            ]
        },
        autocomplete: (context) => autocompleteTags(context, tagNameCache),
        async handle(context) {
            switch (getSubcommand(context.data)?.name) {
                case 'create':
                    await createTag(context, databases, messageBuilder.start, tagNameCache);
                    return;
                case 'edit':
                    await editTag(context, databases, messageBuilder.start);
                    return;
                case 'delete':
                    await deleteTag(context, databases, tagNameCache);
                    return;
                case 'public':
                    await setPublicChannel(context, databases);
                    return;
                case 'public-list':
                    await listPublicChannels(context, databases);
                    return;
                default:
                    await context.respond(ephemeralText('Choose a valid tag management action.'));
            }
        }
    };
}

async function sendTag(context, databases) {
    const name = getTagName(context);
    if (!name) {
        await invalidTagName(context);
        return;
    }

    const tag = await databases.snail.mongo.Tag.findById(name).lean();
    if (!tag) {
        await context.respond(ephemeralText('That tag does not exist.'));
        return;
    }

    const isPublic = await isTagPublicInChannel(databases, tag, context.channelID);
    context.logger.info('tag.get.started', {
        tag: name,
        isPublic,
        channelID: context.channelID,
        userID: context.userID
    });

    const message = buildTagMessage(tag);
    context.logger.info('tag.get.rendered', {
        tag: name,
        componentCount: message.components?.length ?? 0,
        fileCount: message.files?.length ?? 0
    });

    if (!isPublic) {
        message.flags |= 64;
    }

    await context.respond(message);
}

async function listTags(context, tagNameCache, accentColor) {
    const names = await tagNameCache.get();
    if (!names.length) {
        await context.respond(ephemeralText("Oh no! I don't have any tags."));
        return;
    }

    await context.respond(
        ephemeralComponentsMessage(
            accentContainer(
                accentColor,
                textDisplay(`## Tags (${names.length})\n${names.map((name) => `\`${name}\``).join(' ')}`)
            )
        )
    );
}

async function createTag(context, databases, startBuilder, tagNameCache) {
    const name = getTagName(context);
    if (!name) {
        await invalidTagName(context);
        return;
    }

    const existing = await databases.snail.mongo.Tag.findById(name).lean();
    if (existing) {
        await context.respond(ephemeralText('That tag already exists.'));
        return;
    }

    const message = getOptionValue(context.data, 'message');
    if (typeof message === 'string' && message.trim()) {
        await databases.snail.mongo.Tag.create({
            _id: name,
            blocks: textBlocks(message),
            publicChannelIDs: [],
            createdBy: context.userID,
            updatedBy: context.userID
        });
        context.logger.info('tag.created', { tag: name, mode: 'plain_text', userID: context.userID });
        tagNameCache.add(name);
        await context.respond(ephemeralText(`Created the tag \`${name}\`.`));
        return;
    }

    await startBuilder(context, {
        auth: auth.manager,
        label: `Create tag ${name}`,
        mode: OpenModes.Resume,
        submit: ({ context: submitContext, draft }) =>
            submitBuilderTag({ context: submitContext, databases, draft, mode: 'create', name, tagNameCache }),
        submitLabel: 'Create Tag',
        validators: [validateRenderableDraft]
    });
}

async function editTag(context, databases, startBuilder) {
    const name = getTagName(context);
    if (!name) {
        await invalidTagName(context);
        return;
    }

    const tag = await databases.snail.mongo.Tag.findById(name).lean();
    if (!tag) {
        await context.respond(ephemeralText('That tag does not exist.'));
        return;
    }

    const message = getOptionValue(context.data, 'message');
    if (typeof message === 'string' && message.trim()) {
        await databases.snail.mongo.Tag.updateOne(
            { _id: name },
            { $set: { blocks: textBlocks(message), updatedBy: context.userID } }
        );
        context.logger.info('tag.updated', { tag: name, mode: 'plain_text', userID: context.userID });
        await context.respond(ephemeralText(`Updated the tag \`${name}\`.`));
        return;
    }

    const blocks = getTagBlocks(tag);
    await startBuilder(context, {
        auth: auth.manager,
        blocks,
        label: `Edit tag ${name}`,
        mode: OpenModes.ReplaceFromBlocks,
        selectedBlockPath: blocks.length ? [0] : undefined,
        submit: ({ context: submitContext, draft }) =>
            submitBuilderTag({ context: submitContext, databases, draft, mode: 'edit', name }),
        submitLabel: 'Update Tag',
        validators: [validateRenderableDraft]
    });
}

async function deleteTag(context, databases, tagNameCache) {
    const name = getTagName(context);
    if (!name) {
        await invalidTagName(context);
        return;
    }

    const result = await databases.snail.mongo.Tag.deleteOne({ _id: name });
    if (result.deletedCount === 0) {
        await context.respond(ephemeralText('That tag does not exist.'));
        return;
    }

    tagNameCache.delete(name);
    await context.respond(ephemeralText(`Deleted the tag \`${name}\`.`));
}

async function setPublicChannel(context, databases) {
    const name = getTagName(context, { allowAll: true });
    const channelID = getChannelID(context);
    const isPublic = getOptionValue(context.data, 'public');
    if (!name) {
        await invalidTagName(context);
        return;
    }

    if (!channelID) {
        await context.respond(ephemeralText('Choose a valid channel.'));
        return;
    }

    if (typeof isPublic !== 'boolean') {
        await context.respond(ephemeralText('Choose whether the tag should be public.'));
        return;
    }

    if (name === AllTags) {
        await databases.snail.mongo.Channel.updateOne(
            { _id: channelID },
            { $set: { tagsPublicByDefault: isPublic } },
            { upsert: true }
        );
        await context.respond(
            ephemeralText(
                isPublic
                    ? `All tags will now be public by default in <#${channelID}>. Removing a single tag's public setting will not make it private while this channel default is on.`
                    : `All tags are no longer public by default in <#${channelID}>. Tags with their own public setting will still be public there.`
            )
        );
        return;
    }

    const result = await databases.snail.mongo.Tag.updateOne({ _id: name }, publicChannelUpdate(isPublic, channelID));
    if (result.matchedCount === 0) {
        await context.respond(ephemeralText('That tag does not exist.'));
        return;
    }

    const channel = await databases.snail.mongo.Channel.findById(channelID).lean();
    if (isPublic) {
        await context.respond(
            ephemeralText(
                channel?.tagsPublicByDefault
                    ? `The tag \`${name}\` now has a tag-specific public setting in <#${channelID}>. All tags are already public by default there, so this setting only matters if the channel default is turned off later.`
                    : `The tag \`${name}\` will now be public in <#${channelID}>.`
            )
        );
        return;
    }

    await context.respond(
        ephemeralText(
            channel?.tagsPublicByDefault
                ? `Removed the tag-specific public setting for \`${name}\` in <#${channelID}>, but all tags are still public by default in that channel. Use \`/tag-manage public name:all public:false\` there to make tags private by default.`
                : `The tag \`${name}\` no longer has a public setting in <#${channelID}>. It is private there now.`
        )
    );
}

async function listPublicChannels(context, databases) {
    const name = getTagName(context, { allowAll: true });
    if (!name) {
        await invalidTagName(context);
        return;
    }

    if (name === AllTags) {
        const channel = context.channelID
            ? await databases.snail.mongo.Channel.findById(context.channelID).lean()
            : undefined;
        const tags = context.channelID ? await getTagsPublicInChannel(databases, context.channelID) : [];
        const tagList = tags.length ? tags.map((tag) => `\`${tag._id}\``).join(' ') : 'None.';
        const defaultText = channel?.tagsPublicByDefault
            ? `All tags are public by default in <#${context.channelID}>. Tag-specific public settings are listed below, but the channel default already makes every tag public.`
            : `All tags are not public by default in <#${context.channelID}>. Only the tag-specific public settings below are public here.`;

        await context.respond(ephemeralText(`${defaultText}\nTag-specific public settings: ${tagList}`));
        return;
    }

    const tag = await databases.snail.mongo.Tag.findById(name).lean();
    if (!tag) {
        await context.respond(ephemeralText('That tag does not exist.'));
        return;
    }

    const channels = tag.publicChannelIDs ?? [];
    await context.respond(
        ephemeralText(
            channels.length
                ? `The tag \`${name}\` has tag-specific public settings in ${channels.map((channelID) => `<#${channelID}>`).join(' ')}. It may also be public in channels where all tags are public by default.`
                : `The tag \`${name}\` has no tag-specific public channels. It may still be public in channels where all tags are public by default.`
        )
    );
}

async function submitBuilderTag({ context, databases, draft, mode, name, tagNameCache }) {
    if (mode === 'create') {
        const existing = await databases.snail.mongo.Tag.findById(name).lean();
        if (existing) {
            return { ok: false, message: `The tag \`${name}\` already exists.` };
        }

        await databases.snail.mongo.Tag.create({
            _id: name,
            blocks: draft.blocks,
            publicChannelIDs: [],
            createdBy: context.userID,
            updatedBy: context.userID
        });
        context.logger.info('tag.created', { tag: name, mode: 'builder', userID: context.userID });
        tagNameCache.add(name);

        return { ok: true, message: `Created the tag \`${name}\`.` };
    }

    const result = await databases.snail.mongo.Tag.updateOne(
        { _id: name },
        { $set: { blocks: draft.blocks, updatedBy: context.userID } }
    );
    if (result.matchedCount === 0) {
        return { ok: false, message: `The tag \`${name}\` does not exist.` };
    }

    context.logger.info('tag.updated', { tag: name, mode: 'builder', userID: context.userID });

    return { ok: true, message: `Updated the tag \`${name}\`.` };
}

export function buildTagMessage(tag) {
    return buildCompiledMessage(getTagBlocks(tag));
}

export function getTagBlocks(tag) {
    if (tag.blocks?.length) {
        return tag.blocks;
    }

    if (typeof tag.data === 'string' && tag.data) {
        return [{ kind: 'text', content: tag.data }];
    }

    return [];
}

function textBlocks(content) {
    return [{ kind: 'text', content: content.trim() }];
}

async function isTagPublicInChannel(databases, tag, channelID) {
    if (!channelID) {
        return false;
    }

    if (tag.publicChannelIDs?.includes(channelID)) {
        return true;
    }

    const channel = await databases.snail.mongo.Channel.findById(channelID).lean();

    return Boolean(channel?.tagsPublicByDefault);
}

function publicChannelUpdate(isPublic, channelID) {
    return isPublic ? { $addToSet: { publicChannelIDs: channelID } } : { $pull: { publicChannelIDs: channelID } };
}

async function getTagsPublicInChannel(databases, channelID) {
    const tags = await databases.snail.mongo.Tag.find().sort({ _id: 1 }).lean();

    return tags.filter((tag) => tag.publicChannelIDs?.includes(channelID));
}

function sortTagNames(names) {
    return names.sort((left, right) => left.localeCompare(right));
}

async function autocompleteTags(context, tagNameCache) {
    const focused = getFocusedOption(context.data);
    const value = String(focused?.value ?? '').toLowerCase();
    const allowAll = getSubcommand(context.data)?.name?.startsWith('public');
    const names = await tagNameCache.get();

    return [...(allowAll ? [AllTags] : []), ...names.filter((name) => allowAll || name !== AllTags)]
        .filter((name) => name.includes(value))
        .slice(0, TagAutocompleteLimit)
        .map((name) => ({ name, value: name }));
}

function getFocusedOption(data) {
    return getCommandOptions(data).find((option) => option.focused);
}

function getTagName(context, { allowAll = false } = {}) {
    const name = String(getOptionValue(context.data, 'name') ?? '').toLowerCase();
    if (name === AllTags) {
        return allowAll ? name : undefined;
    }

    return TagNamePattern.test(name) ? name : undefined;
}

function getChannelID(context) {
    return String(getOptionValue(context.data, 'channel') ?? context.channelID ?? '').match(/\d{17,20}/)?.[0];
}

function tagNameOption({ allowAll = false, autocomplete = false } = {}) {
    return {
        name: 'name',
        description: allowAll ? 'Tag name, or all for channel defaults.' : 'Tag name.',
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete
    };
}

function channelOption({ description = 'Channel to configure.', required = true } = {}) {
    return {
        name: 'channel',
        description,
        type: ApplicationCommandOptionType.Channel,
        required
    };
}

async function invalidTagName(context) {
    await context.respond(ephemeralText('Use only lowercase letters and numbers for tag names. `all` is reserved.'));
}
