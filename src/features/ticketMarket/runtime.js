import { COLORS } from '../../discord/colors.js';
import { getMessageJumpLink } from '../../discord/messages.js';
import { buildSellerAdMessage } from './render.js';
import { createTicketMarketVisibility } from './visibility.js';

const OWN_DELETE_SUPPRESSION_MS = 10_000;
const MAX_AVAILABILITY_COOLDOWN_MS = 60_000;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const BULK_DELETE_AGE_MARGIN_MS = 60_000;
const MAX_BULK_DELETE_MESSAGES = 100;
const DISCORD_EPOCH = 1_420_070_400_000n;
const ACTIVE_AD_PROJECTION = {
    _id: 1,
    'ticketMarket.activeAd': 1,
};
const LAST_AD_POSTED_AT_PROJECTION = {
    'ticketMarket.lastAdPostedAt': 1,
};

export function createTicketMarketRuntime({ config, settings, log, mysql, rest, sendAdminLog, User }) {
    const activeAds = new Map();
    const expirationTimers = new Map();
    const availabilityUpdates = new Map();
    const availabilityCooldowns = new Map();
    const postingUsers = new Set();
    const ownDeletes = new Set();
    let active = false;
    let adsRestored = false;
    const visibility = createTicketMarketVisibility({
        getMarketState: () => ({ active, activeAdCount: activeAds.size }),
        log,
        rest,
        sendAdminLog,
    });

    return {
        activate,
        deactivate,
        getActiveAd,
        getActiveAdCount,
        resyncVisibility,
        postAd,
        deleteAd,
        refreshAvailability,
        messageCreated,
        messageDeleted,
        messageDeletedBulk,
        resetForSellerChannelChange,
        updateAvailabilityTimeout,
    };

    async function activate() {
        const starting = !active;
        active = true;
        try {
            if (starting) {
                clearExpirationTimers();
                const restoration = await restoreActiveAds(true);
                for (const ad of activeAds.values()) scheduleExpiration(ad);
                log.debug('Restored persisted Ticket Market ads', restoration);
            }

            return await visibility.activate(settings, activeAds.size);
        } catch (error) {
            if (starting) {
                active = false;
                adsRestored = false;
                clearExpirationTimers();
            }
            throw error;
        }
    }

    function getActiveAd(sellerId) {
        return activeAds.get(sellerId);
    }

    async function getActiveAdCount() {
        await restoreActiveAds();
        return activeAds.size;
    }

    async function deactivate(reason) {
        active = false;
        adsRestored = false;
        clearExpirationTimers();
        availabilityCooldowns.clear();
        await visibility.close(settings, activeAds.size, reason);
        log.debug('Stopped Ticket Market runtime', { reason });
    }

    async function resyncVisibility() {
        return visibility.resync(settings, activeAds.size, active);
    }

    async function postAd(userId, draft) {
        if (postingUsers.has(userId)) {
            log.debug('Rejected concurrent Ticket Market ad submission', { userId });
            return 'Your previous Ticket Market ad is still being processed.';
        }

        postingUsers.add(userId);
        const timer = log.time();
        try {
            if (activeAds.has(userId)) {
                log.trace('Rejected Ticket Market ad while seller has an active ad', { userId });
                return 'You already have an active Ticket Market ad.';
            }
            const cooldown = cooldownMessage(await getLastAdPostedAt(userId), settings.adCooldown);
            if (cooldown) {
                log.trace('Rejected Ticket Market ad during cooldown', { userId });
                return cooldown;
            }
            timer.checkpoint('validation');

            if (settings.inventoryVerification) {
                if (!mysql) {
                    log.trace('Rejected Ticket Market ad because inventory verification is unavailable', { userId });
                    return 'Inventory verification is currently unavailable, so Ticket Market ads cannot be posted.';
                }
                let inventory;
                try {
                    inventory = await getWrappedTicketCount(mysql, userId);
                } catch (error) {
                    log.error('Could not verify Wrapped Ticket inventory', { error, userId });
                    return 'Inventory verification is currently unavailable, so Ticket Market ads cannot be posted.';
                }
                log.trace('Checked Wrapped Ticket inventory', {
                    userId,
                    inventory,
                    requested: draft.ticketCount,
                });
                if (inventory < draft.ticketCount) {
                    return `You only have ${inventory.toLocaleString()} Wrapped Ticket${inventory === 1 ? '' : 's'}.`;
                }
            }
            timer.checkpoint('inventory');

            const postedAt = new Date();
            const ad = {
                ...draft,
                sellerId: userId,
                channelId: settings.sellerAdsChannel,
                postedAt,
                ...(settings.availabilityTimeout
                    ? { availabilityDeadline: new Date(postedAt.getTime() + settings.availabilityTimeout) }
                    : {}),
            };
            const sent = await rest.sendMessage(ad.channelId, buildSellerAdMessage(ad));
            ad.messageId = String(sent.id);
            timer.checkpoint('discord');

            try {
                await saveActiveAd(userId, ad);
            } catch (error) {
                try {
                    await deleteDiscordAd(ad, 'Ticket Market persistence failed');
                } catch (cleanupError) {
                    log.error('Could not delete orphaned Ticket Market ad', {
                        error: cleanupError,
                        persistenceError: error,
                        ...adLogData(ad),
                    });
                }
                throw error;
            }
            timer.checkpoint('persistence');
            activeAds.set(userId, ad);
            scheduleExpiration(ad);
            await visibility.syncAfterMutation(settings, 'posting an ad', adLogData(ad));
            timer.checkpoint('permissions');
            timer.info('Posted Ticket Market ad', adLogData(ad));
            await sendAdminLog('Ticket Market Ad Posted', adLogLines(ad, config.guildId), COLORS.success);
            return 'Ticket Market ad posted.';
        } finally {
            postingUsers.delete(userId);
        }
    }

    async function deleteAd(ad, { actorId, reason, source }) {
        const timer = log.time();
        try {
            await deleteDiscordAd(ad, `Ticket Market ad deleted: ${reason}`);
        } catch (error) {
            if (error?.cause?.status !== 404) throw error;
        }
        timer.checkpoint('discord');
        await clearActiveAd(ad.sellerId);
        timer.checkpoint('persistence');
        activeAds.delete(ad.sellerId);
        availabilityCooldowns.delete(ad.sellerId);
        clearExpirationTimer(ad.messageId);
        await visibility.syncAfterMutation(settings, 'deleting an ad', adLogData(ad));
        timer.checkpoint('permissions');
        timer.info('Deleted Ticket Market ad', { ...adLogData(ad), actorId, reason, source });
        await sendAdminLog(
            'Ticket Market Ad Deleted',
            [
                ...adLogLines(ad, config.guildId),
                `**Deleted By:** <@${actorId}> (\`${actorId}\`)`,
                `**Reason:** ${reason}`,
            ],
            COLORS.danger,
        );
    }

    async function refreshAvailability(sellerId, messageId, source) {
        const pending = availabilityUpdates.get(sellerId);
        if (pending) return pending;

        const cooldown = Math.min(MAX_AVAILABILITY_COOLDOWN_MS, settings.availabilityTimeout / 4);
        const lastRefresh = availabilityCooldowns.get(sellerId);
        if (source === 'tradingMessage' && lastRefresh && Date.now() - lastRefresh < cooldown) {
            log.trace('Skipped Ticket Market availability refresh during cooldown', {
                sellerId,
                source,
                cooldown,
            });
            return true;
        }

        const update = (async () => {
            const ad = activeAds.get(sellerId);
            if (!active || !settings.availabilityTimeout || !ad || (messageId && ad.messageId !== messageId)) {
                log.trace('Skipped Ticket Market availability refresh', {
                    sellerId,
                    source,
                    active,
                    timeout: settings.availabilityTimeout,
                    activeAd: Boolean(ad),
                    messageMatches: !messageId || ad?.messageId === messageId,
                });
                return false;
            }

            const timer = log.time();
            const updated = {
                ...ad,
                availabilityDeadline: new Date(Date.now() + settings.availabilityTimeout),
            };
            await updateActiveAd(ad.sellerId, toStoredAd(updated));
            timer.checkpoint('persistence');
            activeAds.set(sellerId, updated);
            scheduleExpiration(updated);
            await rest.editMessage(ad.channelId, ad.messageId, buildSellerAdMessage(updated));
            timer.checkpoint('discord');
            availabilityCooldowns.set(sellerId, Date.now());
            timer.trace('Refreshed Ticket Market ad availability', {
                ...adLogData(updated),
                source,
            });
            return true;
        })();

        availabilityUpdates.set(sellerId, update);
        try {
            return await update;
        } finally {
            if (availabilityUpdates.get(sellerId) === update) availabilityUpdates.delete(sellerId);
        }
    }

    async function messageCreated(message) {
        if (!active) return;
        if (
            !settings.availabilityTimeout ||
            message.channelId !== settings.ticketTradingChannel ||
            message.author.bot
        ) {
            return;
        }
        await refreshAvailability(message.author.id, undefined, 'tradingMessage');
    }

    async function messageDeleted(message) {
        if (!active) return;
        if (message.channelId !== settings.sellerAdsChannel) return;
        const messageId = String(message.id);
        if (ownDeletes.has(messageId)) {
            log.trace('Ignored Snail-deleted Ticket Market ad event', {
                channelId: message.channelId,
                messageId,
            });
            return;
        }
        const ad = findActiveAdByMessage(messageId);
        if (!ad) return;

        const timer = log.time();
        clearExpirationTimer(ad.messageId);
        await clearActiveAd(ad.sellerId);
        timer.checkpoint('persistence');
        activeAds.delete(ad.sellerId);
        availabilityCooldowns.delete(ad.sellerId);
        await visibility.syncAfterMutation(settings, 'reconciling a deleted ad', adLogData(ad));
        timer.checkpoint('permissions');
        timer.info('Reconciled manually deleted Ticket Market ad', adLogData(ad));
        await sendAdminLog('Ticket Market Ad Manually Deleted', adLogLines(ad, config.guildId), COLORS.danger);
    }

    async function messageDeletedBulk(message) {
        if (!active) return;
        if (message.channelId !== settings.sellerAdsChannel) return;

        const messageIds = message.ids.map(String).filter((messageId) => !ownDeletes.has(messageId));
        if (!messageIds.length) return;
        const deletedMessageIds = new Set(messageIds);
        const ads = [...activeAds.values()].filter((ad) => deletedMessageIds.has(ad.messageId));
        if (!ads.length) return;

        const timer = log.time();
        for (const ad of ads) {
            clearExpirationTimer(ad.messageId);
            availabilityCooldowns.delete(ad.sellerId);
        }
        await clearActiveAds(ads.map((ad) => ad.sellerId));
        timer.checkpoint('persistence');
        for (const ad of ads) activeAds.delete(ad.sellerId);
        await visibility.syncAfterMutation(settings, 'reconciling bulk-deleted ads', {
            channelId: message.channelId,
        });
        timer.checkpoint('permissions');
        timer.info('Reconciled manually bulk-deleted Ticket Market ads', {
            channelId: message.channelId,
            ads: ads.length,
        });
        await sendAdminLog(
            'Ticket Market Ads Manually Deleted',
            [
                `**Ads Deleted:** ${ads.length.toLocaleString()}`,
                `**Sellers:** ${ads.map((ad) => `<@${ad.sellerId}>`).join(', ')}`,
            ],
            COLORS.danger,
        );
    }

    async function resetForSellerChannelChange() {
        const timer = log.time();
        clearExpirationTimers();
        await restoreActiveAds(true);
        const ads = [...activeAds.values()];
        const failedDeletes = await deleteDiscordAds(ads, 'Seller Ads channel changed');
        timer.checkpoint('discord');
        availabilityCooldowns.clear();
        await resetAdsAndCooldowns();
        activeAds.clear();
        timer.debug('Cleared Ticket Market ads for channel change', {
            ads: ads.length,
            failedDeletes,
        });
        return { ads: ads.length, failedDeletes };
    }

    async function updateAvailabilityTimeout(timeout) {
        const timer = log.time();
        await restoreActiveAds();
        timer.checkpoint('restoration');
        const now = Date.now();
        const ads = [...activeAds.values()];
        const updatedAds = ads.map((ad) => ({
            ...ad,
            availabilityDeadline: timeout ? new Date(now + timeout) : undefined,
        }));
        await updateActiveAds(updatedAds.map((ad) => ({ sellerId: ad.sellerId, ad: toStoredAd(ad) })));
        timer.checkpoint('persistence');
        for (const ad of updatedAds) activeAds.set(ad.sellerId, ad);
        let failedMessages = 0;
        for (const ad of updatedAds) {
            scheduleExpiration(ad);
            try {
                await rest.editMessage(ad.channelId, ad.messageId, buildSellerAdMessage(ad));
            } catch (error) {
                failedMessages += 1;
                log.warn('Could not update Ticket Market ad availability display', { error, ...adLogData(ad) });
            }
        }
        timer.debug('Updated Ticket Market ad availability', {
            timeout,
            activeAds: ads.length,
            failedMessages,
        });
    }

    async function restoreActiveAds(force = false) {
        if (adsRestored && !force) {
            return { persisted: activeAds.size, missing: 0, unverified: 0, restored: activeAds.size };
        }

        const ads = await loadActiveAds();
        activeAds.clear();
        const missingSellerIds = [];
        const restoredAds = [];
        let unverified = 0;
        for (const ad of ads) {
            try {
                await rest.getMessage(ad.channelId, ad.messageId);
            } catch (error) {
                if (error?.cause?.status === 404) {
                    missingSellerIds.push(ad.sellerId);
                    log.warn('Found missing persisted Ticket Market ad', adLogData(ad));
                    continue;
                }
                unverified += 1;
                log.warn('Could not verify persisted Ticket Market ad', { error, ...adLogData(ad) });
            }
            restoredAds.push(ad);
        }
        await clearActiveAds(missingSellerIds);
        for (const ad of restoredAds) activeAds.set(ad.sellerId, ad);
        adsRestored = true;
        return {
            persisted: ads.length,
            missing: missingSellerIds.length,
            unverified,
            restored: restoredAds.length,
        };
    }

    function scheduleExpiration(ad) {
        clearExpirationTimer(ad.messageId);
        if (!active || !ad.availabilityDeadline) return;
        const delay = new Date(ad.availabilityDeadline).getTime() - Date.now();
        if (delay <= 0) {
            log.trace('Ticket Market ad is already due for expiration', {
                sellerId: ad.sellerId,
                messageId: ad.messageId,
                availabilityDeadline: ad.availabilityDeadline,
                delay,
            });
            expireAdSafely(ad);
            return;
        }
        expirationTimers.set(
            ad.messageId,
            setTimeout(() => expireAdSafely(ad), delay),
        );
        log.trace('Scheduled Ticket Market ad expiration', {
            sellerId: ad.sellerId,
            messageId: ad.messageId,
            availabilityDeadline: ad.availabilityDeadline,
            delay,
        });
    }

    async function expireAd(ad) {
        expirationTimers.delete(ad.messageId);
        const current = activeAds.get(ad.sellerId);
        if (!current || current.messageId !== ad.messageId) {
            log.trace('Ignored stale Ticket Market expiration', {
                sellerId: ad.sellerId,
                messageId: ad.messageId,
                currentMessageId: current?.messageId,
            });
            return;
        }
        const timer = log.time();
        try {
            await deleteDiscordAd(current, 'Ticket Market availability expired');
        } catch (error) {
            if (error?.cause?.status !== 404) {
                log.error('Could not expire Ticket Market ad', { error, ...adLogData(current) });
                return;
            }
        }
        timer.checkpoint('discord');
        await clearActiveAd(current.sellerId);
        timer.checkpoint('persistence');
        activeAds.delete(current.sellerId);
        availabilityCooldowns.delete(current.sellerId);
        await visibility.syncAfterMutation(settings, 'expiring an ad', adLogData(current));
        timer.checkpoint('permissions');
        timer.info('Expired Ticket Market ad', adLogData(current));
        await sendAdminLog('Ticket Market Ad Expired', adLogLines(current, config.guildId), COLORS.danger);
    }

    function expireAdSafely(ad) {
        void expireAd(ad).catch((error) => {
            log.error('Ticket Market expiration failed', { error, ...adLogData(ad) });
        });
    }

    async function deleteDiscordAd(ad, reason) {
        ownDeletes.add(ad.messageId);
        try {
            await rest.deleteMessage(ad.channelId, ad.messageId, reason);
        } catch (error) {
            ownDeletes.delete(ad.messageId);
            throw error;
        }
        setTimeout(() => ownDeletes.delete(ad.messageId), OWN_DELETE_SUPPRESSION_MS);
    }

    async function deleteDiscordAds(ads, reason) {
        const adsByChannel = new Map();
        for (const ad of ads) {
            const channelAds = adsByChannel.get(ad.channelId) ?? [];
            channelAds.push(ad);
            adsByChannel.set(ad.channelId, channelAds);
        }

        let failed = 0;
        for (const [channelId, channelAds] of adsByChannel) {
            const recent = channelAds.filter((ad) => canBulkDelete(ad.messageId));
            const old = channelAds.filter((ad) => !canBulkDelete(ad.messageId));
            for (let index = 0; index < recent.length; index += MAX_BULK_DELETE_MESSAGES) {
                const batch = recent.slice(index, index + MAX_BULK_DELETE_MESSAGES);
                if (batch.length === 1) {
                    old.push(batch[0]);
                    continue;
                }

                const messageIds = batch.map((ad) => ad.messageId);
                for (const messageId of messageIds) ownDeletes.add(messageId);
                try {
                    await rest.deleteMessages(channelId, messageIds, reason);
                    setTimeout(() => {
                        for (const messageId of messageIds) ownDeletes.delete(messageId);
                    }, OWN_DELETE_SUPPRESSION_MS);
                } catch (error) {
                    for (const messageId of messageIds) ownDeletes.delete(messageId);
                    old.push(...batch);
                    log.warn('Could not bulk delete Ticket Market ads; retrying individually', {
                        error,
                        channelId,
                        messageIds,
                    });
                }
            }

            for (const ad of old) {
                try {
                    await deleteDiscordAd(ad, reason);
                } catch (error) {
                    failed += 1;
                    log.warn('Could not delete Ticket Market ad during channel reset', { error, ...adLogData(ad) });
                }
            }
        }
        return failed;
    }

    function clearExpirationTimer(messageId) {
        clearTimeout(expirationTimers.get(messageId));
        expirationTimers.delete(messageId);
    }

    function clearExpirationTimers() {
        for (const timer of expirationTimers.values()) clearTimeout(timer);
        expirationTimers.clear();
    }

    function findActiveAdByMessage(messageId) {
        for (const ad of activeAds.values()) {
            if (ad.messageId === messageId) return ad;
        }
    }

    async function loadActiveAds() {
        const users = await User.find({ 'ticketMarket.activeAd': { $exists: true } }, ACTIVE_AD_PROJECTION).lean();
        return users.map((user) => ({ sellerId: user._id, ...user.ticketMarket.activeAd }));
    }

    async function getLastAdPostedAt(sellerId) {
        const user = await User.findById(sellerId, LAST_AD_POSTED_AT_PROJECTION).lean();
        return user?.ticketMarket?.lastAdPostedAt;
    }

    async function saveActiveAd(sellerId, ad) {
        const { sellerId: _sellerId, postedAt, ...activeAd } = ad;
        await User.updateOne(
            { _id: sellerId },
            {
                $set: {
                    'ticketMarket.activeAd': activeAd,
                    'ticketMarket.lastAdPostedAt': postedAt,
                },
            },
            { upsert: true },
        );
    }

    function updateActiveAd(sellerId, ad) {
        return User.updateOne(
            { _id: sellerId, 'ticketMarket.activeAd': { $exists: true } },
            { $set: { 'ticketMarket.activeAd': ad } },
        );
    }

    function updateActiveAds(ads) {
        if (!ads.length) return;
        return User.bulkWrite(
            ads.map(({ sellerId, ad }) => ({
                updateOne: {
                    filter: { _id: sellerId, 'ticketMarket.activeAd': { $exists: true } },
                    update: { $set: { 'ticketMarket.activeAd': ad } },
                },
            })),
            { ordered: false },
        );
    }

    function clearActiveAd(sellerId) {
        return User.updateOne({ _id: sellerId }, { $unset: { 'ticketMarket.activeAd': '' } });
    }

    function clearActiveAds(sellerIds) {
        if (!sellerIds.length) return;
        return User.updateMany({ _id: { $in: sellerIds } }, { $unset: { 'ticketMarket.activeAd': '' } });
    }

    function resetAdsAndCooldowns() {
        return User.updateMany(
            {
                $or: [
                    { 'ticketMarket.activeAd': { $exists: true } },
                    { 'ticketMarket.lastAdPostedAt': { $exists: true } },
                ],
            },
            {
                $unset: {
                    'ticketMarket.activeAd': '',
                    'ticketMarket.lastAdPostedAt': '',
                },
            },
        );
    }
}

async function getWrappedTicketCount(mysql, userId) {
    const [rows] = await mysql.execute(
        `SELECT COALESCE(ui.count, 0) AS wrapped_ticket_count
         FROM user u
         LEFT JOIN user_item ui ON ui.uid = u.uid AND ui.name = 'common_tickets'
         WHERE u.id = ?`,
        [userId],
    );
    return Number(rows[0]?.wrapped_ticket_count ?? 0);
}

function cooldownMessage(lastPostedAt, cooldown) {
    if (!lastPostedAt || !cooldown) return;
    const availableAt = new Date(lastPostedAt).getTime() + cooldown;
    if (availableAt <= Date.now()) return;
    return `Wait until <t:${Math.floor(availableAt / 1000)}:R> before posting another ad.`;
}

function canBulkDelete(messageId) {
    const timestamp = Number((BigInt(messageId) >> 22n) + DISCORD_EPOCH);
    return timestamp > Date.now() - BULK_DELETE_MAX_AGE_MS + BULK_DELETE_AGE_MARGIN_MS;
}

function toStoredAd(ad) {
    const { sellerId: _sellerId, postedAt: _postedAt, availabilityDeadline, ...record } = ad;
    return {
        ...record,
        ...(availabilityDeadline ? { availabilityDeadline } : {}),
    };
}

function adLogData(ad) {
    return {
        sellerId: ad.sellerId,
        channelId: ad.channelId,
        messageId: ad.messageId,
        ticketCount: ad.ticketCount,
        price: ad.price,
        availabilityDeadline: ad.availabilityDeadline,
    };
}

function adLogLines(ad, guildId) {
    return [
        `**Seller:** <@${ad.sellerId}> (\`${ad.sellerId}\`)`,
        `**Ad:** ${getMessageJumpLink({ guildId, channelId: ad.channelId, messageId: ad.messageId })}`,
        `**Stock:** ${ad.ticketCount.toLocaleString()}`,
        `**Price:** ${ad.price.toLocaleString()}`,
        ...(ad.note ? [`**Note:** ${ad.note}`] : []),
    ];
}
