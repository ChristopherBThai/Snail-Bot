import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ComponentType,
    GatewayDispatchEvents,
} from 'discord-api-types/v10';
import { getInteractionUser } from '../../discord/interactions.js';
import { createSupporterRolesRepository } from './repository.js';

const SYNC_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const CACHE_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const BATCH_DELAY_MS = 100;
const BATCH_SIZE = 250;
const ROLE_NAMES = Object.freeze([
    'base',
    'ticketCommon',
    'discordUncommon',
    'patreonCommon',
    'patreonUncommon',
    'legendary',
    'fabled',
]);

const ROLES_COMMAND_DEFINITION = {
    type: ApplicationCommandType.ChatInput,
    name: 'roles',
    description: 'Synchronize your supporter perk roles.',
    options: [
        {
            type: ApplicationCommandOptionType.Boolean,
            name: 'optout',
            description: 'Whether Snail should stop managing your supporter perk roles.',
            required: false,
        },
    ],
};

/** @type {import('../../packages.js').PackageSetup} */
export default function setup({ config, logging, rest, services, unavailable }) {
    const log = logging.createLogger('supporterRoles');
    const configuredRoles = config.roles?.supporters ?? {};
    const missing = [
        ...ROLE_NAMES.map((name) => !configuredRoles[name] && `roles.supporters.${name} (config)`).filter(Boolean),
        ...(unavailable.snail.mongo ?? []),
        ...(unavailable.owo.mysql ?? []),
    ];
    const repository =
        services.snail.mongo && services.owo.mysql
            ? createSupporterRolesRepository({ mysql: services.owo.mysql, User: services.snail.mongo.User })
            : undefined;
    const synchronizedUntil = new Map();
    const pendingMembers = new Map();
    const pendingSynchronizations = new Map();
    const synchronizingUsers = new Set();
    const optedOutUsers = new Set();
    let active = false;
    let batchTimer;
    let querying = false;
    let synchronizing = false;
    let nextCachePruneAt = Date.now() + CACHE_PRUNE_INTERVAL_MS;

    return {
        name: 'Supporter Roles',
        missing,
        commands: [{ definition: ROLES_COMMAND_DEFINITION, handle: synchronizeRoleManagement }],
        feature: {
            id: 'supporterRoles',
            description: 'Synchronizes Discord roles with active OwO supporter perks.',
            toggleable: true,
            activate,
            deactivate,
            events: [{ event: GatewayDispatchEvents.MessageCreate, handle: messageCreated }],
            settings: {
                pages: [{ id: 'overview', label: 'Overview', render: renderOverview }],
            },
        },
    };

    function renderOverview() {
        const now = Date.now();
        pruneCache(now);
        nextCachePruneAt = now + CACHE_PRUNE_INTERVAL_MS;
        return [
            {
                type: ComponentType.TextDisplay,
                content:
                    '### Runtime\n' +
                    `**Cached Users:** ${synchronizedUntil.size.toLocaleString()}\n` +
                    `**Pending Users:** ${pendingMembers.size.toLocaleString()}\n` +
                    `**Pending Role Updates:** ${pendingSynchronizations.size.toLocaleString()}\n` +
                    `**Processing Users:** ${synchronizingUsers.size.toLocaleString()}\n` +
                    `**Opted Out Users:** ${optedOutUsers.size.toLocaleString()}\n` +
                    `**MySQL Status:** ${querying ? 'Querying' : batchTimer ? 'Buffering' : 'Idle'}\n` +
                    `**Role Status:** ${synchronizing ? 'Synchronizing' : 'Idle'}`,
            },
        ];
    }

    async function activate() {
        const userIds = await repository.getOptedOutUserIds();
        optedOutUsers.clear();
        for (const userId of userIds) optedOutUsers.add(userId);
        active = true;
        nextCachePruneAt = Date.now() + CACHE_PRUNE_INTERVAL_MS;
        log.debug('Loaded supporter role opt-outs', { users: optedOutUsers.size });
        scheduleBatch();
    }

    function deactivate() {
        active = false;
        clearTimeout(batchTimer);
        batchTimer = undefined;
        pendingMembers.clear();
        pendingSynchronizations.clear();
        synchronizingUsers.clear();
        synchronizedUntil.clear();
    }

    function messageCreated(message) {
        if (!active || message.author.bot || !message.member || message.guildId !== config.guildId) return;
        const member = {
            userId: message.author.id,
            roles: message.member.roles,
        };
        const now = Date.now();
        if (now >= nextCachePruneAt) {
            pruneCache(now);
            nextCachePruneAt = now + CACHE_PRUNE_INTERVAL_MS;
        }
        const expiresAt = synchronizedUntil.get(member.userId);
        if (expiresAt > now || synchronizingUsers.has(member.userId)) return;
        synchronizedUntil.delete(member.userId);

        pendingMembers.set(member.userId, member);
        scheduleBatch();
    }

    function scheduleBatch() {
        if (!active || querying || batchTimer || !pendingMembers.size) return;
        batchTimer = setTimeout(() => {
            batchTimer = undefined;
            void queryBatches();
        }, BATCH_DELAY_MS);
    }

    async function queryBatches() {
        if (querying) return;
        querying = true;
        let members = [];

        try {
            while (active && pendingMembers.size) {
                members = [...pendingMembers.values()].slice(0, BATCH_SIZE);
                for (const member of members) {
                    pendingMembers.delete(member.userId);
                    synchronizingUsers.add(member.userId);
                }
                await queryBatch(members);
                members = [];
            }
        } catch (error) {
            for (const member of members) synchronizingUsers.delete(member.userId);
            log.error('Supporter role batch query failed', { error, users: members.length });
        } finally {
            querying = false;
            scheduleBatch();
        }
    }

    async function queryBatch(members) {
        const timer = log.time();
        const perksByUserId = await repository.getPerks(members.map((member) => member.userId));
        if (!active) return;

        for (const member of members) {
            pendingSynchronizations.set(member.userId, {
                member,
                perks: perksByUserId.get(member.userId),
            });
        }
        void synchronizePendingMembers();
        timer.debug('Loaded supporter role batch', {
            users: members.length,
            pendingRoleUpdates: pendingSynchronizations.size,
        });
    }

    async function synchronizePendingMembers() {
        if (synchronizing) return;
        synchronizing = true;

        try {
            while (active && pendingSynchronizations.size) {
                const [userId, pending] = pendingSynchronizations.entries().next().value;
                pendingSynchronizations.delete(userId);
                try {
                    await synchronizeMember(pending.member, pending.perks);
                } catch (error) {
                    log.error('Supporter role synchronization failed', { error, userId });
                } finally {
                    synchronizingUsers.delete(userId);
                }
            }
        } finally {
            synchronizing = false;
        }
    }

    async function synchronizeMember(member, perks) {
        const timer = log.time();
        const optedOut = optedOutUsers.has(member.userId);
        const changes = await synchronizeRoles(member, perks, optedOut);
        const expirations = Object.values(perks)
            .filter((perk) => perk.rank)
            .map((perk) => perk.expiration.getTime());
        const expiresAt = Math.min(Date.now() + SYNC_CACHE_DURATION_MS, ...expirations);
        synchronizedUntil.set(member.userId, expiresAt);
        timer.checkpoint('discord');
        const data = {
            userId: member.userId,
            optedOut,
            ticketRank: perks.ticket.rank,
            patreonRank: perks.patreon.rank,
            discordRank: perks.discord.rank,
            added: changes.added,
            removed: changes.removed,
            pendingUsers: pendingMembers.size,
            pendingRoleUpdates: pendingSynchronizations.size,
        };
        if (changes.added || changes.removed) timer.info('Synchronized supporter roles', data);
        else timer.trace('Supporter roles already current', data);
    }

    async function synchronizeRoles(member, perks, optedOut) {
        const roles = new Set(member.roles);
        let added = 0;
        let removed = 0;

        async function setRole(roleId, shouldHaveRole) {
            if (shouldHaveRole === roles.has(roleId)) return;
            if (shouldHaveRole) {
                await rest.addRole(config.guildId, member.userId, roleId, 'Snail supporter perk role sync');
                roles.add(roleId);
                added += 1;
            } else {
                await rest.removeRole(config.guildId, member.userId, roleId, 'Snail supporter perk role sync');
                roles.delete(roleId);
                removed += 1;
            }
        }

        const hasPerk = Boolean(perks.ticket.rank || perks.patreon.rank || perks.discord.rank);
        const protectedDonator = roles.has(configuredRoles.legendary) || roles.has(configuredRoles.fabled);
        if (hasPerk) await setRole(configuredRoles.base, true);
        else if (!protectedDonator) await setRole(configuredRoles.base, false);

        if (optedOut) {
            await setRole(configuredRoles.ticketCommon, false);
            await setRole(configuredRoles.discordUncommon, false);
            return { added, removed };
        }

        switch (perks.ticket.rank) {
            case 0:
                await setRole(configuredRoles.ticketCommon, false);
                break;
            case 1:
            case 3:
                await setRole(configuredRoles.ticketCommon, true);
                break;
            default:
                log.warn('Unknown Ticket supporter rank', {
                    userId: member.userId,
                    rank: perks.ticket.rank,
                });
                return { added, removed };
        }

        switch (perks.discord.rank) {
            case 0:
                await setRole(configuredRoles.discordUncommon, false);
                break;
            case 3:
                await setRole(configuredRoles.discordUncommon, true);
                break;
            default:
                log.warn('Unknown Discord supporter rank', {
                    userId: member.userId,
                    rank: perks.discord.rank,
                });
                return { added, removed };
        }

        switch (perks.patreon.rank) {
            case 0:
                await setRole(configuredRoles.patreonCommon, false);
                await setRole(configuredRoles.patreonUncommon, false);
                break;
            case 1:
            case 3:
                break;
            default:
                log.warn('Unknown Patreon supporter rank', {
                    userId: member.userId,
                    rank: perks.patreon.rank,
                });
                return { added, removed };
        }

        return { added, removed };
    }

    async function synchronizeRoleManagement({ interaction, defer, respond }) {
        await defer({ ephemeral: true });
        const optout = interaction.data.options?.find((option) => option.name === 'optout')?.value;
        const userId = getInteractionUser(interaction).id;
        if (typeof optout === 'boolean') {
            await repository.setOptedOut(userId, optout);
            if (optout) optedOutUsers.add(userId);
            else optedOutUsers.delete(userId);
            log.info('Changed supporter role management', { userId, optout });
        }

        const member = { userId, roles: interaction.member.roles };
        const perksByUserId = await repository.getPerks([userId]);
        const perks = perksByUserId.get(userId);
        await synchronizeMember(member, perks);

        const optedOut = optedOutUsers.has(userId);
        await respond(
            optedOut
                ? 'Your supporter roles are synchronized. You are currently opted out of supporter perk role management.'
                : 'Your supporter roles are synchronized.',
            { ephemeral: true },
        );
    }

    function pruneCache(now) {
        for (const [userId, expiresAt] of synchronizedUntil) {
            if (expiresAt <= now) synchronizedUntil.delete(userId);
        }
    }
}
