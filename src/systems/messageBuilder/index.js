import { randomUUID } from 'node:crypto';
import { ButtonStyle, ComponentType, MessageFlags, SeparatorSpacingSize } from 'discord-api-types/v10';
import { disableComponents, getInteractionUser, getModalValue, getSelectValue } from '../../discord/interactions.js';
import { suppressMentions } from '../../discord/messages.js';
import {
    addComponent,
    addItem,
    createComponent,
    createDraft,
    deleteComponent,
    deleteItem,
    getComponent,
    getItems,
    moveComponent,
    replaceComponent,
    replaceItem,
    validateDraft,
} from './draft.js';
import { hydrateDraft, hydrateMessage } from './hydrate.js';
import { buildController, buildEditModal, buildMessage, buildPreview, IDS, INPUTS } from './render.js';
import { createDraftRepository } from './repository.js';

const SESSION_LIFETIME = 14 * 60_000;

/**
 * @typedef {import('@discordeno/types').Camelize<import('@discordeno/types').DiscordInteraction>} Interaction
 */

/**
 * @typedef {import('@discordeno/types').InteractionCallbackData} Message
 */

/**
 * The interaction behavior required to open a Message Builder session.
 *
 * @typedef {object} MessageBuilderContext
 * @property {Interaction} interaction
 * @property {(message: string | Message, options?: { ephemeral?: boolean }) => Promise<unknown>} respond
 */

/**
 * @typedef {object} MessageBuilderResult
 * @property {boolean} ok
 * @property {string} message
 */

/**
 * @typedef {object} MessageBuilderOptions
 * @property {(interaction: Interaction, config: Record<string, unknown>) => boolean | Promise<boolean>} authorize
 * @property {(message: Message) => MessageBuilderResult | Promise<MessageBuilderResult>} submit
 * @property {string} [title]
 * @property {string} [submitLabel]
 * @property {boolean} [allowMentions]
 * @property {NonNullable<Message['components']>} [components]
 * @property {import('@discordeno/types').Camelize<import('@discordeno/types').DiscordMessage>} [sourceMessage]
 */

export default function createMessageBuilder({ config, logging, rest, services, unavailable }) {
    const log = logging.createLogger('messageBuilder');
    const missing = unavailable.snail.mongo ?? [];
    const repository = services.snail.mongo ? createDraftRepository(services.snail.mongo.User) : undefined;
    const sessions = new Map();

    return {
        name: 'Message Builder',
        missing,
        components: [
            interaction(IDS.select, selectTopLevel),
            interaction(IDS.child, selectChild),
            interaction(IDS.add, add),
            interaction(IDS.action, act),
            interaction(IDS.item, selectItem),
            interaction(IDS.itemAction, actOnItem),
        ],
        modals: [interaction(IDS.modal, submitModal)],
        start,
    };

    function interaction(prefix, handle) {
        return { prefix, handle };
    }

    /**
     * Opens a Message Builder session for the interaction's user.
     *
     * @param {MessageBuilderContext} context
     * @param {MessageBuilderOptions} options
     */
    async function start(context, options) {
        if (!repository) throw new Error(`Message Builder unavailable: ${missing.join(', ')}`);
        if (typeof options?.authorize !== 'function') throw new TypeError('Message Builder requires authorize');
        if (typeof options?.submit !== 'function') throw new TypeError('Message Builder requires submit');
        if (options.components && options.sourceMessage) {
            throw new TypeError('Message Builder cannot receive both components and sourceMessage');
        }

        const user = getInteractionUser(context.interaction);
        if (!user) throw new Error('Could not resolve Message Builder user');

        let hydrated;
        if (options.sourceMessage) {
            hydrated = hydrateMessage(options.sourceMessage);
        } else if (options.components) {
            hydrated = hydrateDraft(
                { components: options.components, allowMentions: options.allowMentions === true },
                {
                    allowIncomplete: true,
                },
            );
        } else {
            const stored = await repository.load(user.id);
            hydrated = stored ? hydrateDraft(stored, { allowIncomplete: true }) : { ok: true, draft: createDraft() };
            if (!hydrated.ok) {
                log.warn('Discarded invalid saved Message Builder draft', { userId: user.id });
                hydrated = { ok: true, draft: createDraft() };
            }
        }

        if (!hydrated.ok) {
            await context.respond(hydrated.message, { ephemeral: true });
            return;
        }

        if (options.allowMentions === false) hydrated.draft.allowMentions = false;

        const previous = sessions.get(user.id);
        const session = {
            id: randomUUID(),
            userId: user.id,
            token: context.interaction.token,
            expiresAt: Date.now() + SESSION_LIFETIME,
            title: options.title ?? 'Message Builder',
            submitLabel: options.submitLabel ?? 'Submit',
            allowMentions: options.allowMentions,
            authorize: options.authorize,
            submit: options.submit,
            draft: hydrated.draft,
            selection: { path: [] },
            busy: false,
        };

        await repository.save(user.id, session.draft);
        await context.respond(buildPreview(session.draft), { ephemeral: true });
        const controller = await context.respond(buildController(session), { ephemeral: true });
        session.controllerId = controller.id;
        session.timeout = setTimeout(() => closeSession(session, 'Session expired.'), session.expiresAt - Date.now());
        sessions.set(user.id, session);
        log.debug('Message Builder session opened', { userId: user.id });

        if (previous) closeSession(previous, 'Replaced by a newer Message Builder session.');
    }

    async function selectTopLevel(context) {
        await withSession(context, async (session) => {
            const value = getSelectValue(context.interaction);
            session.selection = { path: value === 'root' ? [] : [Number(value)] };
            await context.update(buildController(session));
        });
    }

    async function selectChild(context) {
        await withSession(context, async (session) => {
            const value = getSelectValue(context.interaction);
            session.selection =
                value === 'root'
                    ? { path: [session.selection.path[0]] }
                    : { path: [session.selection.path[0], Number(value)] };
            await context.update(buildController(session));
        });
    }

    async function selectItem(context) {
        await withSession(context, async (session) => {
            session.selection.item = Number(getSelectValue(context.interaction));
            await context.update(buildController(session));
        });
    }

    async function add(context) {
        await withSession(context, async (session) => {
            const type = Number(getSelectValue(context.interaction));
            if ([ComponentType.TextDisplay, ComponentType.Separator, ComponentType.Section].includes(type)) {
                await context.openModal(buildEditModal(session, modalAction(type, 'add'), createComponent(type)));
                return;
            }

            await mutate(context, session, () => addComponent(session.draft, session.selection, createComponent(type)));
        });
    }

    async function act(context) {
        await withSession(context, async (session) => {
            const action = readAction(context.interaction.data.customId);

            if (action === 'edit') {
                const component = getComponent(session.draft, session.selection.path);
                const kind = modalAction(component?.type, 'edit');
                if (!kind) {
                    await context.respond('This component has no settings of its own.', { ephemeral: true });
                    return;
                }
                await context.openModal(buildEditModal(session, kind, component));
                return;
            }

            if (action === 'delete')
                return mutate(context, session, () => deleteComponent(session.draft, session.selection));
            if (action === 'up')
                return mutate(context, session, () => moveComponent(session.draft, session.selection, -1));
            if (action === 'down')
                return mutate(context, session, () => moveComponent(session.draft, session.selection, 1));

            if (action === 'mentions') {
                if (session.allowMentions === false) return;
                return mutate(context, session, () => ({
                    ok: true,
                    draft: { ...session.draft, allowMentions: !session.draft.allowMentions },
                    selection: session.selection,
                }));
            }

            if (action === 'clear') {
                return mutate(context, session, () => ({
                    ok: true,
                    draft: createDraft([], session.draft.allowMentions),
                    selection: { path: [] },
                }));
            }

            if (action === 'submit') await submit(context, session);
        });
    }

    async function actOnItem(context) {
        await withSession(context, async (session) => {
            const action = readAction(context.interaction.data.customId);
            const component = getComponent(session.draft, session.selection.path);
            const kind = component?.type === ComponentType.ActionRow ? 'link' : 'image';

            if (action === 'delete')
                return mutate(context, session, () => deleteItem(session.draft, session.selection));
            if (action === 'add') return context.openModal(buildEditModal(session, `${kind}Add`, undefined));

            const item = getItems(component)?.[session.selection.item];
            if (!item) return context.respond('Select an item first.', { ephemeral: true });
            await context.openModal(buildEditModal(session, `${kind}Edit`, item));
        });
    }

    async function submitModal(context) {
        await withSession(context, async (session) => {
            const action = readAction(context.interaction.data.customId);
            const values = modalValues(context.interaction);
            const invalid = validateModal(action, values);
            if (invalid) {
                await context.respond(invalid, { ephemeral: true });
                return;
            }
            let operation;

            if (action === 'linkAdd' || action === 'imageAdd') {
                operation = () => addItem(session.draft, session.selection, componentFromModal(action, values));
            } else if (action.endsWith('Edit') && (action.startsWith('link') || action.startsWith('image'))) {
                operation = () => replaceItem(session.draft, session.selection, componentFromModal(action, values));
            } else {
                const component = componentFromModal(
                    action,
                    values,
                    getComponent(session.draft, session.selection.path),
                );
                operation = action.endsWith('Add')
                    ? () => addComponent(session.draft, session.selection, component)
                    : () => replaceComponent(session.draft, session.selection, component);
            }

            await mutate(context, session, operation);
        });
    }

    async function mutate(context, session, operation) {
        const result = operation();
        if (!result.ok) {
            await context.respond(result.message, { ephemeral: true });
            return;
        }

        const hydrated = hydrateDraft(result.draft, { allowIncomplete: true });
        if (!hydrated.ok) {
            await context.respond(hydrated.message, { ephemeral: true });
            return;
        }

        await context.deferUpdate();
        await repository.save(session.userId, result.draft);
        session.draft = result.draft;
        session.selection = result.selection;
        await context.editResponse(buildController(session));
        await rest.editOriginalInteractionResponse(session.token, buildPreview(session.draft));
        log.debug('Message Builder draft updated', { userId: session.userId });
    }

    async function submit(context, session) {
        const validation = validateDraft(session.draft);
        if (!validation.ok) {
            await context.respond(validation.message, { ephemeral: true });
            return;
        }

        await context.deferUpdate();
        const result = await session.submit(buildMessage(session.draft));
        if (!result || typeof result.ok !== 'boolean' || typeof result.message !== 'string') {
            throw new TypeError('Message Builder submit must return { ok, message }');
        }

        if (!result.ok) {
            log.warn('Message Builder submission rejected', { userId: session.userId });
            await context.respond(result.message, { ephemeral: true });
            return;
        }

        clearTimeout(session.timeout);
        if (sessions.get(session.userId) === session) sessions.delete(session.userId);
        log.info('Message Builder submission completed', { userId: session.userId });

        try {
            await context.editResponse(buildController(session, { disabled: true, notice: 'Submitted.' }));
        } catch (error) {
            log.error('Could not disable Message Builder controller after submission', {
                error,
                userId: session.userId,
            });
        }

        try {
            await context.respond(result.message, { ephemeral: true });
        } catch (error) {
            log.error('Could not send Message Builder submission result', {
                error,
                userId: session.userId,
            });
        }
    }

    async function withSession(context, handle) {
        const session = await getSession(context);
        if (!session) return;
        if (session.busy) {
            await context.respond('The Message Builder is still processing your previous action.', { ephemeral: true });
            return;
        }

        session.busy = true;
        try {
            await handle(session);
        } catch (error) {
            log.error('Message Builder interaction failed', {
                error,
                userId: session.userId,
            });
            await context.respond('Something went wrong. You can update the draft and try again.', {
                ephemeral: true,
            });
        } finally {
            session.busy = false;
        }
    }

    async function getSession(context) {
        const user = getInteractionUser(context.interaction);
        const session = user && sessions.get(user.id);
        const sessionId = context.interaction.data.customId.split(':').at(-1);

        if (!session || session.id !== sessionId) {
            await expireInteraction(context);
            log.warn('Stale Message Builder interaction received', { userId: user?.id });
            return;
        }

        if (!(await session.authorize(context.interaction, config))) {
            log.warn('Message Builder interaction unauthorized', { userId: user.id });
            await context.respond('You are not authorized to use this interaction.', { ephemeral: true });
            return;
        }

        return session;
    }

    async function expireInteraction(context) {
        const components = disableComponents(context.interaction.message?.components ?? []);
        await context.update(suppressMentions({ flags: MessageFlags.IsComponentsV2, components }));
        await context.respond('That Message Builder session has expired.', { ephemeral: true });
    }

    function closeSession(session, notice) {
        clearTimeout(session.timeout);
        if (sessions.get(session.userId) === session) sessions.delete(session.userId);
        if (!session.controllerId) return;

        rest.editFollowupMessage(
            session.token,
            session.controllerId,
            buildController(session, { disabled: true, notice }),
        ).catch((error) => log.warn('Could not disable Message Builder controller', { error, userId: session.userId }));
    }
}

function modalAction(type, verb) {
    const name = {
        [ComponentType.TextDisplay]: 'text',
        [ComponentType.Separator]: 'separator',
        [ComponentType.Container]: 'container',
        [ComponentType.Section]: 'section',
    }[type];
    return name ? `${name}${verb === 'add' ? 'Add' : 'Edit'}` : undefined;
}

function modalValues(interaction) {
    return Object.fromEntries(Object.values(INPUTS).map((id) => [id, getModalValue(interaction, id)]));
}

function componentFromModal(action, values, current) {
    const kind = action.replace(/(Add|Edit)$/, '');
    if (kind === 'text') return { type: ComponentType.TextDisplay, content: values[INPUTS.content] };
    if (kind === 'separator') {
        return {
            type: ComponentType.Separator,
            divider: values[INPUTS.divider] === true,
            spacing:
                values[INPUTS.spacing]?.toLowerCase() === 'large'
                    ? SeparatorSpacingSize.Large
                    : SeparatorSpacingSize.Small,
        };
    }
    if (kind === 'container') {
        const accent = values[INPUTS.accent]?.replace('#', '');
        return {
            type: ComponentType.Container,
            components: current?.components ?? [],
            ...(accent && /^[0-9a-f]{6}$/i.test(accent) ? { accentColor: Number.parseInt(accent, 16) } : {}),
            spoiler: values[INPUTS.spoiler] === true,
        };
    }
    if (kind === 'section') {
        const content = [values[INPUTS.text1], values[INPUTS.text2], values[INPUTS.text3]].filter(Boolean);
        return {
            type: ComponentType.Section,
            components: content.map((text) => ({ type: ComponentType.TextDisplay, content: text })),
            accessory: {
                type: ComponentType.Thumbnail,
                media: { url: values[INPUTS.url] },
                spoiler: values[INPUTS.spoiler] === true,
            },
        };
    }
    if (kind === 'link') {
        return {
            type: ComponentType.Button,
            style: ButtonStyle.Link,
            label: values[INPUTS.label],
            url: values[INPUTS.url],
        };
    }
    return { media: { url: values[INPUTS.url] }, spoiler: values[INPUTS.spoiler] === true };
}

function readAction(customId) {
    return customId.split(':').at(-2);
}

function validateModal(action, values) {
    const kind = action.replace(/(Add|Edit)$/, '');
    const content = values[INPUTS.content];
    if (kind === 'text' && !content?.trim()) return 'Text cannot be empty.';

    const firstText = values[INPUTS.text1];
    if (kind === 'section' && !firstText?.trim()) return 'A section needs at least one text component.';

    const label = values[INPUTS.label];
    if (kind === 'link' && !label?.trim()) return 'A link button needs a label.';

    const url = values[INPUTS.url];
    if ((kind === 'link' || kind === 'image' || kind === 'section') && !isHttpUrl(url)) {
        return 'Enter a valid HTTP or HTTPS URL.';
    }

    const accent = values[INPUTS.accent]?.replace('#', '');
    if (kind === 'container' && accent && !/^[0-9a-f]{6}$/i.test(accent)) {
        return 'Accent color must be a six-digit hexadecimal color.';
    }
}

function isHttpUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}
