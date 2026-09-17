import { randomUUID } from 'node:crypto';
import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ComponentType,
    TextInputStyle,
} from 'discord-api-types/v10';
import {
    getCommandOptionValue,
    getCustomIdSuffix,
    getInteractionUser,
    getModalValue,
} from '../../discord/interactions.js';
import { createPetSource, STATS } from './pets.js';
import { buildExpiredPanel, buildPanel, buildPresetHelp, pageSize, PANEL_PREFIX } from './render.js';

const PANEL_IDLE_TIME = 10 * 60_000;
const MAX_PRESET_LENGTH = 50;
const SORTS = ['name.asc', 'level.asc', 'level.desc', ...STATS.flatMap((stat) => [`${stat}.asc`, `${stat}.desc`])];

/** @type {import('../../packages.js').PackageSetup} */
export default function setup({ config, logging, rest, services }) {
    const log = logging.createLogger('petFinder');
    const source =
        services.owo.mysql &&
        createPetSource({
            mysql: services.owo.mysql,
            log,
            timeZone: config.petFinder?.timeZone ?? 'America/Los_Angeles',
        });
    const panels = new Map();
    return {
        name: 'Pet Finder',
        missing: source ? [] : ['OwO MySQL'],
        feature: { id: 'petFinder', description: 'Find pets by their base stats.', activate: source?.activate },
        commands: [
            {
                definition: {
                    type: ApplicationCommandType.ChatInput,
                    name: 'pets',
                    description: 'Find pets by their six base stats.',
                    options: [
                        {
                            type: ApplicationCommandOptionType.User,
                            name: 'user',
                            description: 'Pet owner.',
                        },
                        {
                            type: ApplicationCommandOptionType.String,
                            name: 'preset',
                            description: 'HP ATT PR WP MAG MR, with optional sorting (e.g. * * * * * * level.desc).',
                            maxLength: MAX_PRESET_LENGTH,
                        },
                        {
                            type: ApplicationCommandOptionType.Boolean,
                            name: 'all',
                            description: 'Search all pets in the catalog instead of owned pets. Ignores user.',
                        },
                    ],
                },
                handle: openPanel,
            },
        ],
        components: [{ prefix: PANEL_PREFIX, handle }],
        modals: [{ prefix: PANEL_PREFIX, handle }],
    };

    async function openPanel(context) {
        const user = getInteractionUser(context.interaction);
        const userId = String(user.id);
        const all = getCommandOptionValue(context.interaction, 'all') === true;
        const ownerId = all ? null : String(getCommandOptionValue(context.interaction, 'user') ?? userId);
        const owner = all || ownerId === userId ? user : context.interaction.data.resolved.users[ownerId];
        if (!owner || owner.bot) return context.respond('Choose a human Discord user.', { ephemeral: true });
        let preset;
        try {
            preset = readPreset(getCommandOptionValue(context.interaction, 'preset') ?? '* * * * * *', all);
        } catch (error) {
            return context.respond(error.message, { ephemeral: true });
        }
        const needsApproval = !all && ownerId !== userId;
        if (
            needsApproval &&
            [...panels.values()].some((p) => p.userId === userId && p.ownerId === ownerId && p.state === 'pending')
        ) {
            return context.respond('You already have a request waiting for this owner.', { ephemeral: true });
        }
        await context.defer();
        const panel = {
            id: randomUUID(),
            userId,
            ownerId,
            ownerName: owner.username,
            all,
            preset,
            channelId: context.interaction.channelId,
            state: needsApproval ? 'pending' : 'active',
            pets: [],
            total: 0,
            omitted: 0,
            page: 0,
            compact: true,
        };
        panels.set(panel.id, panel);
        touch(panel);
        try {
            if (!needsApproval) await loadPanel(panel);
            const message = buildPanel(panel, config.emojis);
            if (needsApproval) message.allowedMentions = { users: [ownerId] };
            const response = await context.editResponse(message);
            panel.messageId = response.id;
            if (!getPanel(panel.id)) await updatePanel(panel);
        } catch (error) {
            log.warn('Could not open pet finder', { error });
            close(panel, 'Could not open this panel. Run /pets to try again.');
            await context.editResponse(buildPanel(panel, config.emojis));
        }
    }

    async function handle(context) {
        const [id, action] = getCustomIdSuffix(context.interaction, PANEL_PREFIX).split(':');
        if (action === 'help') return context.respond(buildPresetHelp(), { ephemeral: true });
        const panel = getPanel(id);
        if (!panel) {
            if (context.interaction.message) await context.update(buildExpiredPanel(context.interaction.message));
            return context.respond('This pet finder has expired.', { ephemeral: true });
        }
        const ownerAction = ['allow', 'decline', 'revoke'].includes(action);
        if (String(getInteractionUser(context.interaction).id) !== (ownerAction ? panel.ownerId : panel.userId)) {
            return context.respond('This control is not available to you.', { ephemeral: true });
        }
        if (['decline', 'cancel', 'revoke'].includes(action)) {
            if (action === 'revoke' && panel.state === 'active') close(panel, 'The owner revoked this panel.');
            else if (action === 'decline' && panel.state === 'pending')
                close(panel, 'The owner declined this request.');
            else if (action === 'cancel' && panel.state === 'pending') close(panel, 'Request cancelled.');
            else return context.respond('This request has already been handled.', { ephemeral: true });
            await context.deferUpdate();
            return;
        }
        if (action === 'allow' && panel.state !== 'pending')
            return context.respond('This request has already been handled.', { ephemeral: true });
        if (panel.state !== 'active' && !(action === 'allow' && panel.state === 'pending'))
            return context.respond('This panel is not ready.', { ephemeral: true });
        if (panel.busy) return context.respond('This panel is updating. Try again in a moment.', { ephemeral: true });
        if (action === 'setPreset') {
            await context.openModal({
                customId: `${PANEL_PREFIX}${panel.id}:preset`,
                title: 'Set preset',
                components: [
                    {
                        type: ComponentType.Label,
                        label: 'HP ATT PR WP MAG MR [sort]',
                        component: {
                            type: ComponentType.TextInput,
                            customId: 'preset',
                            style: TextInputStyle.Short,
                            placeholder: '* * * * * * level.desc',
                            maxLength: MAX_PRESET_LENGTH,
                            required: true,
                        },
                    },
                ],
            });
            if (getPanel(id)) {
                touch(panel);
                await updatePanel(panel);
            }
            return;
        }
        let preset;
        if (action === 'preset') {
            try {
                preset = readPreset(getModalValue(context.interaction, 'preset') ?? '', panel.all);
            } catch (error) {
                return context.respond(error.message, { ephemeral: true });
            }
        }
        panel.busy = true;
        try {
            await context.deferUpdate();
            if (!getPanel(id)) return;
            if ((action === 'allow' || action === 'preset') && !(await loadPanel(panel, preset))) return;
            touch(panel);
            if (action === 'compact') {
                const firstPet = panel.page * pageSize(panel);
                panel.compact = !panel.compact;
                panel.page = Math.floor(firstPet / pageSize(panel));
            }
            const lastPage = Math.max(0, Math.ceil(panel.pets.length / pageSize(panel)) - 1);
            if (action === 'previous') panel.page = Math.max(0, panel.page - 1);
            if (action === 'next') panel.page = Math.min(lastPage, panel.page + 1);
            await updatePanel(panel);
        } catch (error) {
            log.warn('Could not update pet finder', { error });
            if (getPanel(id)) await context.respond('Could not update pets. Try again.', { ephemeral: true });
        } finally {
            panel.busy = false;
        }
    }

    async function loadPanel(panel, preset = panel.preset) {
        const inventory = await source.loadPets(panel.ownerId, preset);
        // Revocation or expiry can occur while the inventory is loading.
        if (!getPanel(panel.id)) return false;
        Object.assign(panel, inventory, { state: 'active', preset, page: 0 });
        return true;
    }

    function getPanel(id) {
        const panel = panels.get(id);
        if (panel && panel.expiresAt <= Date.now()) close(panel);
        return panels.get(id);
    }

    function touch(panel) {
        clearTimeout(panel.timer);
        panel.expiresAt = Date.now() + PANEL_IDLE_TIME;
        panel.timer = setTimeout(() => close(panel), PANEL_IDLE_TIME);
    }

    function close(panel, notice) {
        if (!panels.delete(panel.id)) return;
        clearTimeout(panel.timer);
        if (notice) Object.assign(panel, { state: 'closed', notice, pets: [] });
        else panel.expired = true;
        void updatePanel(panel);
    }

    function updatePanel(panel) {
        // Expiry/revocation can overlap a Discord edit. Queue the closing edit last.
        panel.writing = (panel.writing ?? Promise.resolve())
            .then(async () => {
                if (panel.messageId)
                    await rest.editMessage(panel.channelId, panel.messageId, buildPanel(panel, config.emojis));
            })
            .catch((error) => log.warn('Could not update pet finder message', { error }));
        return panel.writing;
    }
}

function readPreset(input, all = false) {
    if (input.length > MAX_PRESET_LENGTH) throw new Error('Presets can contain up to 50 characters.');
    const parts = input.trim().split(/\s+/);
    if (parts.length !== 6 && parts.length !== 7)
        throw new Error('Enter six stats in HP ATT PR WP MAG MR order, followed by an optional sort.');
    const sort = parts[6] ?? 'name.asc';
    if (!SORTS.includes(sort)) throw new Error('Unknown sort. Use name.asc, level.asc/desc, or a stat with .asc/desc.');
    if (all && sort.startsWith('level.')) throw new Error('Catalog pets have no level. Sort by name or a stat.');
    const filters = {};
    for (const [index, stat] of STATS.entries()) {
        const match = /^(\d+|\*)(?:-(\d+|\*))?$/.exec(parts[index]);
        if (!match) throw new Error(`${stat.toUpperCase()}: use *, a whole number, or min-max.`);
        const [min, max] = [match[1], match[2] ?? match[1]].map((value) => (value === '*' ? undefined : Number(value)));
        if ([min, max].some((value) => value !== undefined && !Number.isSafeInteger(value)))
            throw new Error(`${stat.toUpperCase()}: value is too large.`);
        if (min > max) throw new Error(`${stat.toUpperCase()}: minimum cannot exceed maximum.`);
        if (min !== undefined || max !== undefined) filters[stat] = { min, max };
    }
    return { filters, sort, text: input };
}
