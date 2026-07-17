import { ComponentType, MessageFlags } from 'discord-api-types/v10';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { hasManagerAccess } from '../../discord/auth.js';
import setupTags from './index.js';

let messageBuilder;

const config = {
    colors: {
        ui: {
            warning: 0xfee75c
        }
    }
};

describe('tag routes', () => {
    beforeEach(() => {
        messageBuilder = {
            start: vi.fn()
        };
    });

    test('uses manager access for tag management', () => {
        const manageRoute = getRoute(createContribution(), 'tag-manage');

        expect(manageRoute.authorize).toBe(hasManagerAccess);
        expect(manageRoute.command.staff).toBe(true);
    });

    test('sends private tags ephemerally and suppresses mentions', async () => {
        const models = createModels({
            tags: [
                {
                    _id: 'rules',
                    message: createSavedMessage('Read <@&123456789012345678>'),
                    publicChannelIds: [],
                    uses: 4
                }
            ]
        });
        const tagRoute = getRoute(createContribution({ models }), 'tag');
        const context = createContext({
            subcommand: subcommand('get', [{ name: 'name', value: 'rules' }])
        });

        await tagRoute.handle(context);

        expect(context.respond).toHaveBeenCalledWith(
            expect.objectContaining({
                allowed_mentions: { parse: [] },
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            })
        );
        expect(models.tags.get('rules').uses).toBe(5);
        expect(models.tags.get('rules').lastUsedAt).toBeInstanceOf(Date);
    });

    test('sends public tags publicly but still suppresses mentions', async () => {
        const tagRoute = getRoute(
            createContribution({
                tags: [
                    {
                        _id: 'rules',
                        message: createSavedMessage('Read <@&123456789012345678>'),
                        publicChannelIds: ['channel-id']
                    }
                ]
            }),
            'tag'
        );
        const context = createContext({
            subcommand: subcommand('get', [{ name: 'name', value: 'rules' }])
        });

        await tagRoute.handle(context);

        expect(context.respond).toHaveBeenCalledWith(
            expect.objectContaining({
                allowed_mentions: { parse: [] },
                flags: MessageFlags.IsComponentsV2
            })
        );
    });

    test('renders legacy text tags without writing old fields', async () => {
        const models = createModels({
            tags: [
                {
                    _id: 'legacy',
                    data: 'Legacy text'
                }
            ]
        });
        const tagRoute = getRoute(createContribution({ models }), 'tag');
        const context = createContext({
            subcommand: subcommand('get', [{ name: 'name', value: 'legacy' }])
        });

        await tagRoute.handle(context);

        const response = context.respond.mock.calls[0][0];
        expect(response).toEqual(
            expect.objectContaining({
                allowed_mentions: { parse: [] },
                content: 'Legacy text',
                flags: MessageFlags.Ephemeral
            })
        );
        expect(models.tags.get('legacy').data).toBe('Legacy text');
        expect(models.tags.get('legacy')).not.toHaveProperty('message');
    });

    test('lists tag names', async () => {
        const tagRoute = getRoute(
            createContribution({
                tags: [
                    { _id: 'alpha', message: createSavedMessage('Alpha') },
                    { _id: 'beta', message: createSavedMessage('Beta') }
                ]
            }),
            'tag'
        );
        const context = createContext({ subcommand: subcommand('list') });

        await tagRoute.handle(context);

        const response = context.respond.mock.calls[0][0];
        const responseText = getTextDisplayContents(response).join('\n');
        expect(response.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
        expect(responseText).toContain('alpha');
        expect(responseText).toContain('beta');
    });

    test('creates plain text tags as saved message payloads', async () => {
        const models = createModels();
        const manageRoute = getRoute(createContribution({ models }), 'tag-manage');
        const context = createContext({
            subcommand: subcommand('create', [
                { name: 'name', value: 'hello' },
                { name: 'message', value: 'Hello world' }
            ])
        });

        await manageRoute.handle(context);

        expect(models.tags.get('hello')).toMatchObject({
            _id: 'hello',
            createdBy: 'user-id',
            updatedBy: 'user-id',
            message: {
                flags: MessageFlags.IsComponentsV2,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content: 'Hello world'
                    }
                ]
            }
        });
        expect(context.respond).toHaveBeenCalledWith('Created the tag `hello`.', { ephemeral: true });
    });

    test('opens Message Builder for rich tag creation with mentions locked off', async () => {
        const models = createModels();
        const manageRoute = getRoute(createContribution({ models }), 'tag-manage');
        const context = createContext({
            subcommand: subcommand('create', [{ name: 'name', value: 'rich' }])
        });
        messageBuilder.start.mockImplementationOnce(async (_context, options) => {
            const confirmation = await options.submit({
                context,
                message: createSavedMessage('Rich tag')
            });

            expect(confirmation).toBe('Created the tag `rich`.');
        });

        await manageRoute.handle(context);

        expect(messageBuilder.start).toHaveBeenCalledWith(
            context,
            expect.objectContaining({
                authorize: hasManagerAccess,
                allowMentions: false,
                label: 'Create tag `rich`',
                submitError: 'Could not create the tag `rich`.',
                submitLabel: 'Create Tag'
            })
        );
        expect(models.tags.get('rich').message).toEqual(createSavedMessage('Rich tag'));
    });

    test('opens Message Builder for rich tag editing from the saved payload', async () => {
        const savedMessage = createSavedMessage('Old rich tag');
        const manageRoute = getRoute(
            createContribution({
                tags: [
                    {
                        _id: 'rich',
                        message: savedMessage,
                        publicChannelIds: []
                    }
                ]
            }),
            'tag-manage'
        );
        const context = createContext({
            subcommand: subcommand('edit', [{ name: 'name', value: 'rich' }])
        });

        await manageRoute.handle(context);

        expect(messageBuilder.start).toHaveBeenCalledWith(
            context,
            expect.objectContaining({
                allowMentions: false,
                label: 'Edit tag `rich`',
                sourceMessage: savedMessage,
                submitError: 'Could not update the tag `rich`.',
                submitLabel: 'Update Tag'
            })
        );
    });

    test('opens Message Builder for legacy tag editing from a compatible payload', async () => {
        const manageRoute = getRoute(
            createContribution({
                tags: [
                    {
                        _id: 'legacy',
                        data: 'Legacy text',
                        publicChannelIds: []
                    }
                ]
            }),
            'tag-manage'
        );
        const context = createContext({
            subcommand: subcommand('edit', [{ name: 'name', value: 'legacy' }])
        });

        await manageRoute.handle(context);

        expect(messageBuilder.start).toHaveBeenCalledWith(
            context,
            expect.objectContaining({
                sourceMessage: expect.objectContaining({
                    content: 'Legacy text'
                })
            })
        );
    });

    test('updates autocomplete cache after plain text create', async () => {
        const models = createModels({
            tags: [{ _id: 'alpha', message: createSavedMessage('Alpha') }]
        });
        const contribution = createContribution({ models });
        const tagRoute = getRoute(contribution, 'tag');
        const manageRoute = getRoute(contribution, 'tag-manage');

        const first = await tagRoute.autocomplete(
            createContext({
                subcommand: subcommand('get', [{ focused: true, name: 'name', value: 'a' }])
            })
        );
        await manageRoute.handle(
            createContext({
                subcommand: subcommand('create', [
                    { name: 'name', value: 'beta' },
                    { name: 'message', value: 'Beta' }
                ])
            })
        );
        const second = await tagRoute.autocomplete(
            createContext({
                subcommand: subcommand('get', [{ focused: true, name: 'name', value: 'b' }])
            })
        );

        expect(first).toEqual([{ name: 'alpha', value: 'alpha' }]);
        expect(second).toEqual([{ name: 'beta', value: 'beta' }]);
        expect(models.findCount).toBe(1);
    });

    test('sets public defaults on channels', async () => {
        const models = createModels();
        const manageRoute = getRoute(createContribution({ models }), 'tag-manage');

        await manageRoute.handle(
            createContext({
                subcommand: subcommand('public-default', [{ name: 'public', value: true }])
            })
        );

        expect(models.channels.get('channel-id').tagsPublicByDefault).toBe(true);
        expect(models.tags.size).toBe(0);
    });

    test('sets tag-specific public channels on tags', async () => {
        const models = createModels({
            tags: [{ _id: 'rules', message: createSavedMessage('Rules'), publicChannelIds: [] }]
        });
        const manageRoute = getRoute(createContribution({ models }), 'tag-manage');

        await manageRoute.handle(
            createContext({
                subcommand: subcommand('public', [
                    { name: 'name', value: 'rules' },
                    { name: 'public', value: true }
                ])
            })
        );

        expect(models.channels.has('channel-id')).toBe(false);
        expect(models.tags.get('rules').publicChannelIds).toEqual(['channel-id']);
    });

    test('deletes tags and removes them from autocomplete cache', async () => {
        const models = createModels({
            tags: [{ _id: 'rules', message: createSavedMessage('Rules'), publicChannelIds: [] }]
        });
        const contribution = createContribution({ models });
        const tagRoute = getRoute(contribution, 'tag');
        const manageRoute = getRoute(contribution, 'tag-manage');

        await tagRoute.autocomplete(
            createContext({ subcommand: subcommand('get', [{ focused: true, name: 'name' }]) })
        );
        await manageRoute.handle(
            createContext({
                subcommand: subcommand('delete', [{ name: 'name', value: 'rules' }])
            })
        );
        const choices = await tagRoute.autocomplete(
            createContext({
                subcommand: subcommand('get', [{ focused: true, name: 'name', value: 'r' }])
            })
        );

        expect(models.tags.has('rules')).toBe(false);
        expect(choices).toEqual([]);
    });
});

function createContribution({ channels, models, tags } = {}) {
    const databaseModels = models ?? createModels({ channels, tags });

    return setupTags({
        config,
        databases: {
            snail: {
                mongo: {
                    models: databaseModels.models
                }
            }
        },
        services: {
            messageBuilder
        }
    });
}

function getRoute(contribution, commandName) {
    return contribution.routes.find((route) => route.command.name === commandName);
}

function subcommand(name, options = []) {
    return {
        name,
        options
    };
}

function createContext({ channelId = 'channel-id', subcommand } = {}) {
    return {
        channelId,
        data: {
            options: [subcommand]
        },
        respond: vi.fn(),
        userId: 'user-id'
    };
}

function createSavedMessage(content) {
    return {
        flags: MessageFlags.IsComponentsV2,
        components: [
            {
                type: ComponentType.TextDisplay,
                content
            }
        ]
    };
}

function getTextDisplayContents(message) {
    return message.components.flatMap((component) => collectTextDisplayContents(component));
}

function collectTextDisplayContents(component) {
    return [
        ...(component.type === ComponentType.TextDisplay ? [component.content] : []),
        ...(component.components ?? []).flatMap((child) => collectTextDisplayContents(child))
    ];
}

function createModels({ channels = [], tags = [] } = {}) {
    const db = {
        channels: new Map(channels.map((channel) => [channel._id, structuredClone(channel)])),
        findCount: 0,
        tags: new Map(tags.map((tag) => [tag._id, structuredClone(tag)]))
    };
    const result = {
        channels: db.channels,
        get findCount() {
            return db.findCount;
        },
        models: {},
        tags: db.tags
    };

    result.models = {
        Channel: {
            findById(id) {
                return {
                    lean: async () => clone(db.channels.get(id))
                };
            },
            async updateOne(query, update) {
                const channel = db.channels.get(query._id) ?? { _id: query._id };
                Object.assign(channel, update.$set);
                db.channels.set(query._id, channel);
            }
        },
        Tag: {
            async create(tag) {
                db.tags.set(tag._id, structuredClone(tag));
            },
            async deleteOne(query) {
                return {
                    deletedCount: db.tags.delete(query._id) ? 1 : 0
                };
            },
            find(query = {}) {
                db.findCount += 1;
                const tags = [...db.tags.values()].filter((tag) => {
                    if (query.publicChannelIds) {
                        return tag.publicChannelIds?.includes(query.publicChannelIds);
                    }

                    return true;
                });

                return {
                    sort() {
                        return {
                            lean: async () => clone(tags.sort((left, right) => left._id.localeCompare(right._id)))
                        };
                    }
                };
            },
            findById(id) {
                return {
                    lean: async () => clone(db.tags.get(id))
                };
            },
            async updateOne(query, update) {
                const tag = db.tags.get(query._id);
                if (!tag) {
                    return {
                        matchedCount: 0
                    };
                }

                if (update.$set) {
                    Object.assign(tag, structuredClone(update.$set));
                }

                if (update.$inc?.uses) {
                    tag.uses = (tag.uses ?? 0) + update.$inc.uses;
                }

                if (
                    update.$addToSet?.publicChannelIds &&
                    !tag.publicChannelIds.includes(update.$addToSet.publicChannelIds)
                ) {
                    tag.publicChannelIds.push(update.$addToSet.publicChannelIds);
                }

                if (update.$pull?.publicChannelIds) {
                    tag.publicChannelIds = tag.publicChannelIds.filter(
                        (channelId) => channelId !== update.$pull.publicChannelIds
                    );
                }

                return {
                    matchedCount: 1
                };
            }
        }
    };

    return result;
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}
