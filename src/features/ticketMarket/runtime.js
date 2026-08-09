import { OverwriteType, PermissionFlagsBits } from 'discord-api-types/v10';
import { getMessageJumpLink } from '../../discord/messages.js';
import { buildSellerAdMessage } from './render.js';

const SELLER_ADS_PERMISSIONS = PermissionFlagsBits.ViewChannel;
const TICKET_TRADING_PERMISSIONS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;
const OWN_DELETE_SUPPRESSION_MS = 10_000;
const MAX_AVAILABILITY_COOLDOWN_MS = 60_000;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const BULK_DELETE_AGE_MARGIN_MS = 60_000;
const MAX_BULK_DELETE_MESSAGES = 100;
const DISCORD_EPOCH = 1_420_070_400_000n;
const CHANNEL_SYNC_RETRY_DELAYS = Object.freeze([1_000, 3_000]);

export function createTicketMarketRuntime({ config, getSettings, log, repository, rest, sendAdminLog }) {
    const activeAds = new Map();
    const expirationTimers = new Map();
    const availabilityUpdates = new Map();
    const availabilityCooldowns = new Map();
    const postingUsers = new Set();
    const ownDeletes = new Set();
    let active = false;
    let adsRestored = false;
    let ticketTradingOpen;

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
        if (starting) {
            clearExpirationTimers();
            const restoration = await restoreActiveAds(true);
            for (const ad of activeAds.values()) scheduleExpiration(ad);
            log.debug('Restored persisted Ticket Market ads', restoration);
        }

        const settings = await getSettings();
        await setChannelVisibility(
            settings.sellerAdsChannel,
            settings.marketAccessRole,
            SELLER_ADS_PERMISSIONS,
            true,
            'Ticket Market enabled',
        );
        const activeAdCount = await syncTicketTradingChannel(true);
        log.debug('Applied Ticket Market channel visibility', {
            sellerAdsChannel: settings.sellerAdsChannel,
            ticketTradingChannel: settings.ticketTradingChannel,
            marketAccessRole: settings.marketAccessRole,
        });
        return activeAdCount;
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
        await closeMarketChannels(reason);
        log.debug('Stopped Ticket Market runtime', { reason });
    }

    async function resyncVisibility() {
        const settings = await getSettings();
        await setChannelVisibility(
            settings.sellerAdsChannel,
            settings.marketAccessRole,
            SELLER_ADS_PERMISSIONS,
            active,
            'Ticket Market manually resynchronized',
        );
        return syncTicketTradingChannel(true);
    }

    async function postAd(userId, draft, settings) {
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
            const cooldown = cooldownMessage(await repository.getLastAdPostedAt(userId), settings.adCooldown);
            if (cooldown) {
                log.trace('Rejected Ticket Market ad during cooldown', { userId });
                return cooldown;
            }
            timer.checkpoint('validation');

            if (settings.inventoryVerification) {
                const inventory = await repository.getWrappedTicketCount(userId);
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
                await repository.saveActiveAd(userId, ad);
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
            await syncAfterAdMutation('posting an ad', ad);
            timer.checkpoint('permissions');
            timer.info('Posted Ticket Market ad', adLogData(ad));
            await sendAdminLog('Ticket Market Ad Posted', adLogLines(ad, config.guildId));
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
        await repository.clearActiveAd(ad.sellerId);
        timer.checkpoint('persistence');
        activeAds.delete(ad.sellerId);
        availabilityCooldowns.delete(ad.sellerId);
        clearExpirationTimer(ad.messageId);
        await syncAfterAdMutation('deleting an ad', ad);
        timer.checkpoint('permissions');
        timer.info('Deleted Ticket Market ad', { ...adLogData(ad), actorId, reason, source });
        await sendAdminLog('Ticket Market Ad Deleted', [
            ...adLogLines(ad, config.guildId),
            `**Deleted By:** <@${actorId}> (\`${actorId}\`)`,
            `**Reason:** ${reason}`,
        ]);
    }

    async function refreshAvailability(sellerId, messageId, source) {
        const pending = availabilityUpdates.get(sellerId);
        if (pending) return pending;

        const settings = await getSettings();
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
            await repository.updateActiveAd(ad.sellerId, toStoredAd(updated));
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
        const settings = await getSettings();
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
        const settings = await getSettings();
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
        await repository.clearActiveAd(ad.sellerId);
        timer.checkpoint('persistence');
        activeAds.delete(ad.sellerId);
        availabilityCooldowns.delete(ad.sellerId);
        await syncAfterAdMutation('reconciling a deleted ad', ad);
        timer.checkpoint('permissions');
        timer.info('Reconciled manually deleted Ticket Market ad', adLogData(ad));
        await sendAdminLog('Ticket Market Ad Manually Deleted', adLogLines(ad, config.guildId));
    }

    async function messageDeletedBulk(message) {
        if (!active) return;
        const settings = await getSettings();
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
        await repository.clearActiveAds(ads.map((ad) => ad.sellerId));
        timer.checkpoint('persistence');
        for (const ad of ads) activeAds.delete(ad.sellerId);
        await syncAfterAdMutation('reconciling bulk-deleted ads', { channelId: message.channelId });
        timer.checkpoint('permissions');
        timer.info('Reconciled manually bulk-deleted Ticket Market ads', {
            channelId: message.channelId,
            ads: ads.length,
        });
        await sendAdminLog('Ticket Market Ads Manually Deleted', [
            `**Ads Deleted:** ${ads.length.toLocaleString()}`,
            `**Sellers:** ${ads.map((ad) => `<@${ad.sellerId}>`).join(', ')}`,
        ]);
    }

    async function resetForSellerChannelChange() {
        const timer = log.time();
        clearExpirationTimers();
        await restoreActiveAds(true);
        const ads = [...activeAds.values()];
        const failedDeletes = await deleteDiscordAds(ads, 'Seller Ads channel changed');
        timer.checkpoint('discord');
        availabilityCooldowns.clear();
        await repository.resetAdsAndCooldowns();
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
        await repository.updateActiveAds(updatedAds.map((ad) => ({ sellerId: ad.sellerId, ad: toStoredAd(ad) })));
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

        const ads = await repository.getActiveAds();
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
        await repository.clearActiveAds(missingSellerIds);
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
        await repository.clearActiveAd(current.sellerId);
        timer.checkpoint('persistence');
        activeAds.delete(current.sellerId);
        availabilityCooldowns.delete(current.sellerId);
        await syncAfterAdMutation('expiring an ad', current);
        timer.checkpoint('permissions');
        timer.info('Expired Ticket Market ad', adLogData(current));
        await sendAdminLog('Ticket Market Ad Expired', adLogLines(current, config.guildId));
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

    async function syncTicketTradingChannel(forceUpdate = false) {
        const settings = await getSettings();
        const previous = ticketTradingOpen;
        const open = active && activeAds.size > 0;
        if (!forceUpdate && ticketTradingOpen === open) {
            log.trace('Ticket Trading visibility already current', { activeAds: activeAds.size, open });
            return activeAds.size;
        }
        await setChannelVisibility(
            settings.ticketTradingChannel,
            settings.marketAccessRole,
            TICKET_TRADING_PERMISSIONS,
            open,
            `Ticket Market ${open ? 'opened' : 'closed'}`,
        );
        ticketTradingOpen = open;
        log.info(`${open ? 'Opened' : 'Closed'} Ticket Trading`, {
            activeAds: activeAds.size,
            channelId: settings.ticketTradingChannel,
            roleId: settings.marketAccessRole,
        });
        if (previous !== undefined && previous !== open) {
            await sendTicketTradingStateLog(open, settings, open ? 'Active ads available' : 'No active ads remain');
        }
        return activeAds.size;
    }

    async function syncAfterAdMutation(action, ad) {
        const data = ad.messageId ? adLogData(ad) : ad;
        let failure;
        try {
            await syncTicketTradingChannel();
            return;
        } catch (error) {
            failure = error;
        }

        for (const [retry, delay] of CHANNEL_SYNC_RETRY_DELAYS.entries()) {
            log.warn(`Retrying Ticket Trading synchronization after ${action}`, {
                error: failure,
                retry: retry + 1,
                delay,
                ...data,
            });
            await wait(delay);
            try {
                await syncTicketTradingChannel();
                return;
            } catch (error) {
                failure = error;
            }
        }

        log.error(`Could not synchronize Ticket Trading after ${action}; retries exhausted`, {
            error: failure,
            retries: CHANNEL_SYNC_RETRY_DELAYS.length,
            ...data,
        });
        await sendAdminLog('Ticket Trading Synchronization Failed', [
            `**Action:** ${action}`,
            `**Active Ads:** ${activeAds.size.toLocaleString()}`,
            'Automatic retries were exhausted. Use Resync in Ticket Market Settings after correcting the problem.',
        ]);
    }

    async function closeMarketChannels(reason) {
        const settings = await getSettings();
        if (!settings.marketAccessRole) {
            ticketTradingOpen = false;
            return;
        }
        const tradingWasOpen = ticketTradingOpen === true;
        const channels = [
            [settings.sellerAdsChannel, SELLER_ADS_PERMISSIONS],
            [settings.ticketTradingChannel, TICKET_TRADING_PERMISSIONS],
        ];
        await Promise.all(
            channels
                .filter(([channelId]) => channelId)
                .map(([channelId, permissions]) =>
                    setChannelVisibility(
                        channelId,
                        settings.marketAccessRole,
                        permissions,
                        false,
                        `Ticket Market closed: ${reason}`,
                    ),
                ),
        );
        ticketTradingOpen = false;
        log.debug('Closed Ticket Market channels', {
            reason,
            sellerAdsChannel: settings.sellerAdsChannel,
            ticketTradingChannel: settings.ticketTradingChannel,
            marketAccessRole: settings.marketAccessRole,
        });
        if (tradingWasOpen) await sendTicketTradingStateLog(false, settings, reason);
    }

    function sendTicketTradingStateLog(open, settings, reason) {
        return sendAdminLog(`Ticket Trading ${open ? 'Opened' : 'Closed'}`, [
            `**Channel:** <#${settings.ticketTradingChannel}>`,
            `**Active Ads:** ${activeAds.size.toLocaleString()}`,
            `**Reason:** ${reason}`,
        ]);
    }

    function setChannelVisibility(channelId, roleId, permissions, visible, reason) {
        return rest.editChannelPermissionOverrides(
            channelId,
            {
                id: roleId,
                type: OverwriteType.Role,
                allow: visible ? permissions.toString() : '0',
                deny: visible ? '0' : TICKET_TRADING_PERMISSIONS.toString(),
            },
            reason,
        );
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
}

function cooldownMessage(lastPostedAt, cooldown) {
    if (!lastPostedAt || !cooldown) return;
    const availableAt = new Date(lastPostedAt).getTime() + cooldown;
    if (availableAt <= Date.now()) return;
    return `Wait until <t:${Math.floor(availableAt / 1000)}:R> before posting another ad.`;
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
