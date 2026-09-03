import { loadSupporterPerks } from './perks.js';

const SYNC_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const CACHE_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const BATCH_DELAY_MS = 100;
const BATCH_SIZE = 250;
const USER_ID_PROJECTION = { _id: 1 };

export function createSupporterRoleSynchronization({ guildId, roleIds, User, mysql, rest, log }) {
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
        initialize,
        activate,
        deactivate,
        memberAdded,
        memberUpdated,
        messageCreated,
        setOptout,
        synchronizeUser,
        getStatus,
    };

    async function initialize() {
        const users = await User.find({ 'supporterRoles.optout': true }, USER_ID_PROJECTION).lean();
        for (const user of users) optedOutUsers.add(user._id);
        log.debug('Loaded supporter role opt-outs', { users: optedOutUsers.size });
    }

    function activate() {
        active = true;
        nextCachePruneAt = Date.now() + CACHE_PRUNE_INTERVAL_MS;
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

    function memberAdded(member) {
        queueMember(member.guildId, member.user, member.roles, true);
    }

    function memberUpdated(member) {
        queueMember(member.guildId, member.user, member.roles);
    }

    function messageCreated(message) {
        if (!message.member) return;
        queueMember(message.guildId, message.author, message.member.roles);
    }

    function queueMember(memberGuildId, user, roles, force = false) {
        if (!active || user.bot || memberGuildId !== guildId) return;
        const member = { userId: user.id, roles };
        const now = Date.now();
        if (now >= nextCachePruneAt) {
            pruneCache(now);
            nextCachePruneAt = now + CACHE_PRUNE_INTERVAL_MS;
        }
        const expiresAt = synchronizedUntil.get(member.userId);
        if ((!force && expiresAt > now) || synchronizingUsers.has(member.userId)) return;
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
        const perksByUserId = await loadSupporterPerks(
            mysql,
            members.map((member) => member.userId),
        );
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

    async function setOptout(userId, optout) {
        await User.updateOne({ _id: userId }, { $set: { 'supporterRoles.optout': optout } }, { upsert: true });
        if (optout) optedOutUsers.add(userId);
        else optedOutUsers.delete(userId);
        log.info('Changed supporter role management', { userId, optout });
    }

    async function synchronizeUser(member) {
        const perksByUserId = await loadSupporterPerks(mysql, [member.userId]);
        await synchronizeMember(member, perksByUserId.get(member.userId));
        return { optedOut: optedOutUsers.has(member.userId) };
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
                await rest.addRole(guildId, member.userId, roleId, 'Snail supporter perk role sync');
                roles.add(roleId);
                added += 1;
            } else {
                await rest.removeRole(guildId, member.userId, roleId, 'Snail supporter perk role sync');
                roles.delete(roleId);
                removed += 1;
            }
        }

        const hasPerk = Boolean(perks.ticket.rank || perks.patreon.rank || perks.discord.rank);
        const protectedDonator = roles.has(roleIds.legendary) || roles.has(roleIds.fabled);
        if (hasPerk) await setRole(roleIds.base, true);
        else if (!protectedDonator) await setRole(roleIds.base, false);

        if (optedOut) {
            await setRole(roleIds.ticketCommon, false);
            await setRole(roleIds.discordUncommon, false);
            return { added, removed };
        }

        switch (perks.ticket.rank) {
            case 0:
                await setRole(roleIds.ticketCommon, false);
                break;
            case 1:
            case 3:
                await setRole(roleIds.ticketCommon, true);
                break;
            default:
                log.warn('Unknown Ticket supporter rank', { userId: member.userId, rank: perks.ticket.rank });
                return { added, removed };
        }

        switch (perks.discord.rank) {
            case 0:
                await setRole(roleIds.discordUncommon, false);
                break;
            case 3:
                await setRole(roleIds.discordUncommon, true);
                break;
            default:
                log.warn('Unknown Discord supporter rank', { userId: member.userId, rank: perks.discord.rank });
                return { added, removed };
        }

        switch (perks.patreon.rank) {
            case 0:
                await setRole(roleIds.patreonCommon, false);
                await setRole(roleIds.patreonUncommon, false);
                break;
            case 1:
            case 3:
                break;
            default:
                log.warn('Unknown Patreon supporter rank', { userId: member.userId, rank: perks.patreon.rank });
                return { added, removed };
        }

        return { added, removed };
    }

    function getStatus() {
        const now = Date.now();
        pruneCache(now);
        nextCachePruneAt = now + CACHE_PRUNE_INTERVAL_MS;
        return {
            cachedUsers: synchronizedUntil.size,
            pendingUsers: pendingMembers.size,
            pendingRoleUpdates: pendingSynchronizations.size,
            processingUsers: synchronizingUsers.size,
            optedOutUsers: optedOutUsers.size,
            mysql: querying ? 'Querying' : batchTimer ? 'Buffering' : 'Idle',
            roles: synchronizing ? 'Synchronizing' : 'Idle',
        };
    }

    function pruneCache(now) {
        for (const [userId, expiresAt] of synchronizedUntil) {
            if (expiresAt <= now) synchronizedUntil.delete(userId);
        }
    }
}
