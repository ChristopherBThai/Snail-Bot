import { OverwriteType, PermissionFlagsBits } from 'discord-api-types/v10';

const SELLER_ADS_PERMISSIONS = PermissionFlagsBits.ViewChannel;
const TICKET_TRADING_PERMISSIONS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;
const SYNC_RETRY_DELAYS = Object.freeze([1_000, 3_000]);

export function createTicketMarketVisibility({ getMarketState, log, rest, sendAdminLog }) {
    let ticketTradingOpen;

    return {
        activate,
        close,
        resync,
        syncAfterMutation,
    };

    async function activate(settings, activeAdCount) {
        await setChannelVisibility(
            settings.sellerAdsChannel,
            settings.marketAccessRole,
            SELLER_ADS_PERMISSIONS,
            true,
            'Ticket Market enabled',
        );
        await syncTicketTradingChannel(settings, activeAdCount, true, true);
        log.debug('Applied Ticket Market channel visibility', {
            sellerAdsChannel: settings.sellerAdsChannel,
            ticketTradingChannel: settings.ticketTradingChannel,
            marketAccessRole: settings.marketAccessRole,
        });
        return activeAdCount;
    }

    async function resync(settings, activeAdCount, active) {
        await setChannelVisibility(
            settings.sellerAdsChannel,
            settings.marketAccessRole,
            SELLER_ADS_PERMISSIONS,
            active,
            'Ticket Market manually resynchronized',
        );
        await syncTicketTradingChannel(settings, activeAdCount, active, true);
        return activeAdCount;
    }

    async function syncAfterMutation(settings, action, data) {
        let failure;
        try {
            await syncCurrentTicketTradingChannel(settings);
            return;
        } catch (error) {
            failure = error;
        }

        for (const [retry, delay] of SYNC_RETRY_DELAYS.entries()) {
            log.warn(`Retrying Ticket Trading synchronization after ${action}`, {
                error: failure,
                retry: retry + 1,
                delay,
                ...data,
            });
            await wait(delay);
            try {
                await syncCurrentTicketTradingChannel(settings);
                return;
            } catch (error) {
                failure = error;
            }
        }

        log.error(`Could not synchronize Ticket Trading after ${action}; retries exhausted`, {
            error: failure,
            retries: SYNC_RETRY_DELAYS.length,
            ...data,
        });
        const { activeAdCount } = getMarketState();
        await sendAdminLog('Ticket Trading Synchronization Failed', [
            `**Action:** ${action}`,
            `**Active Ads:** ${activeAdCount.toLocaleString()}`,
            'Automatic retries were exhausted. Use Resync in Ticket Market Settings after correcting the problem.',
        ]);
    }

    function syncCurrentTicketTradingChannel(settings) {
        const { active, activeAdCount } = getMarketState();
        return syncTicketTradingChannel(settings, activeAdCount, active);
    }

    async function syncTicketTradingChannel(settings, activeAdCount, active, forceUpdate = false) {
        const previous = ticketTradingOpen;
        const open = active && activeAdCount > 0;
        if (!forceUpdate && ticketTradingOpen === open) {
            log.trace('Ticket Trading visibility already current', { activeAds: activeAdCount, open });
            return;
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
            activeAds: activeAdCount,
            channelId: settings.ticketTradingChannel,
            roleId: settings.marketAccessRole,
        });
        if (previous !== undefined && previous !== open) {
            await sendStateLog(open, settings, activeAdCount, open ? 'Active ads available' : 'No active ads remain');
        }
    }

    async function close(settings, activeAdCount, reason) {
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
        if (tradingWasOpen) await sendStateLog(false, settings, activeAdCount, reason);
    }

    function sendStateLog(open, settings, activeAdCount, reason) {
        return sendAdminLog(`Ticket Trading ${open ? 'Opened' : 'Closed'}`, [
            `**Channel:** <#${settings.ticketTradingChannel}>`,
            `**Active Ads:** ${activeAdCount.toLocaleString()}`,
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
                deny: visible ? '0' : permissions.toString(),
            },
            reason,
        );
    }
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
