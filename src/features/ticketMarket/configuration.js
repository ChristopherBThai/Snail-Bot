import { getCustomIdSuffix, getInteractionUser, getSelectValue } from '../../discord/interactions.js';
import { buildRulesMessage } from './render.js';
import {
    buildAds,
    buildChannels,
    buildOverview,
    buildRoles,
    buildRules,
    buildSettingModal,
    getMissingSettings,
    getSettingLabel,
    isAccessRoleSetting,
    readSetting,
    SETTING_KEYS,
    SETTINGS_IDS,
} from './settings.js';

export function createTicketMarketConfiguration({
    config,
    features,
    inventoryAvailable,
    log,
    persistSetting,
    rest,
    runtime,
    sendAdminLog,
    settings,
}) {
    return {
        activate,
        deactivate,
        renderOverview,
        renderChannels: () => buildChannels(settings),
        renderRoles: () => buildRoles(settings),
        renderRules: () => buildRules(settings),
        renderAds: () => buildAds(settings, inventoryAvailable),
        setChannel,
        setRole,
        openSettingModal,
        saveSetting,
        toggleInventory,
        repairRulesMessage,
        resyncMarket,
    };

    async function activate() {
        const timer = log.time();
        const missing = getMissingSettings(settings);
        if (missing.length) {
            await runtime.deactivate('incomplete configuration');
            timer.warn('Ticket Market configuration is incomplete', { missing });
            return;
        }
        if (settings.inventoryVerification && !inventoryAvailable) {
            log.warn('Ticket Market inventory verification unavailable; new ads are blocked');
        }

        await refreshRulesMessage();
        timer.checkpoint('rulesMessage');
        const activeAds = await runtime.activate();
        timer.checkpoint('runtime');
        timer.info('Ticket Market activated', { activeAds });
    }

    function deactivate() {
        return runtime.deactivate('feature disabled');
    }

    async function renderOverview() {
        return buildOverview(
            settings,
            await runtime.getActiveAdCount(),
            isEnabled(),
            inventoryAvailable,
            config.guildId,
        );
    }

    async function setChannel(context) {
        const key = getCustomIdSuffix(context.interaction, SETTINGS_IDS.channel);
        const channelId = getSelectValue(context.interaction);
        if (!channelId) return context.respond('Choose a valid channel.', { ephemeral: true });

        await context.deferUpdate();
        const previous = settings[key];
        if (key === SETTING_KEYS.sellerAdsChannel && previous && previous !== channelId) {
            await resetMarketForSellerChannelChange(previous, channelId, context);
        } else {
            if (key === SETTING_KEYS.marketRulesChannel && previous !== channelId) await clearRulesMessage();
            await persistSetting(key, channelId);
            if (key === SETTING_KEYS.ticketTradingChannel && previous !== channelId) {
                await clearMarketOverwrite(previous, settings.marketAccessRole, 'Ticket Trading channel changed');
            }
            await apply();
            const actorId = getInteractionUser(context.interaction).id;
            log.info('Changed Ticket Market channel', { key, previous, channelId, actorId });
            await sendAdminLog('Ticket Market Channel Changed', [
                `**Setting:** ${getSettingLabel(key)}`,
                `**Previous:** ${previous ? `<#${previous}>` : 'Not configured'}`,
                `**New:** <#${channelId}>`,
                `**Changed By:** <@${actorId}>`,
            ]);
        }
        await context.editResponse(await renderSettings('channels'));
    }

    async function setRole(context) {
        const key = getCustomIdSuffix(context.interaction, SETTINGS_IDS.role);
        const roleId = getSelectValue(context.interaction);
        const role = roleId && context.interaction.data.resolved?.roles?.[roleId];
        if (!role) return context.respond('Choose a valid role.', { ephemeral: true });
        if (role.managed || (isAccessRoleSetting(key) && BigInt(role.permissions ?? 0) !== 0n)) {
            return context.respond(
                role.managed
                    ? 'Choose a role that is not managed by an integration.'
                    : 'Access roles cannot have server permissions.',
                { ephemeral: true },
            );
        }

        await context.deferUpdate();
        const previous = settings[key];
        await persistSetting(key, roleId);
        if (key === SETTING_KEYS.marketAccessRole && previous !== roleId) {
            await Promise.all(
                [settings.sellerAdsChannel, settings.ticketTradingChannel].map((channelId) =>
                    clearMarketOverwrite(channelId, previous, 'Ticket Market access role changed'),
                ),
            );
        }
        await apply();
        const actorId = getInteractionUser(context.interaction).id;
        log.info('Changed Ticket Market role', { key, previous, roleId, actorId });
        await sendAdminLog('Ticket Market Role Changed', [
            `**Setting:** ${getSettingLabel(key)}`,
            `**Previous:** ${previous ? `<@&${previous}>` : 'Not configured'}`,
            `**New:** <@&${roleId}>`,
            `**Changed By:** <@${actorId}>`,
        ]);
        await context.editResponse(await renderSettings('roles'));
    }

    function openSettingModal(context) {
        const key = getCustomIdSuffix(context.interaction, SETTINGS_IDS.edit);
        return context.openModal(buildSettingModal(key, settings[key]));
    }

    async function saveSetting(context) {
        const key = getCustomIdSuffix(context.interaction, SETTINGS_IDS.modal);
        const parsed = readSetting(context.interaction, key);
        if (!parsed.ok) return context.respond(parsed.message, { ephemeral: true });

        await context.deferUpdate();
        const previous = settings[key];
        await persistSetting(key, parsed.value);
        if (key === SETTING_KEYS.availabilityTimeout) await runtime.updateAvailabilityTimeout(parsed.value);
        if (isRulesSetting(key)) await apply(true);
        const actorId = getInteractionUser(context.interaction).id;
        log.info('Changed Ticket Market setting', {
            key,
            ...settingChangeData(key, previous, parsed.value),
            actorId,
        });
        await sendAdminLog('Ticket Market Setting Changed', [
            `**Setting:** ${getSettingLabel(key)}`,
            ...(isRulesSetting(key) ? [`**Changed By:** <@${actorId}>`] : []),
            ...settingChangeLines(key, previous, parsed.value),
            ...(!isRulesSetting(key) ? [`**Changed By:** <@${actorId}>`] : []),
        ]);
        await context.editResponse(await renderSettings(isRulesSetting(key) ? 'rules' : 'ads'));
    }

    async function toggleInventory(context) {
        const value = !settings.inventoryVerification;
        if (value && !inventoryAvailable) {
            return context.respond('Inventory verification is currently unavailable and cannot be enabled.', {
                ephemeral: true,
            });
        }

        await context.deferUpdate();
        await persistSetting(SETTING_KEYS.inventoryVerification, value);
        const actorId = getInteractionUser(context.interaction).id;
        log.info('Changed Ticket Market inventory verification', { enabled: value, actorId });
        await sendAdminLog('Ticket Market Setting Changed', [
            '**Setting:** Inventory Verification',
            `**Previous:** ${value ? 'Disabled' : 'Enabled'}`,
            `**New:** ${value ? 'Enabled' : 'Disabled'}`,
            `**Changed By:** <@${actorId}>`,
        ]);
        await context.editResponse(await renderSettings('ads'));
    }

    async function repairRulesMessage(context) {
        const missing = getMissingSettings(settings);
        if (missing.length) {
            return context.respond(`Ticket Market is not configured. Missing: ${missing.join(', ')}.`, {
                ephemeral: true,
            });
        }
        await context.deferUpdate();
        await refreshRulesMessage();
        log.info('Repaired Ticket Market rules message', { actorId: getInteractionUser(context.interaction).id });
        await context.editResponse(await renderSettings('overview'));
    }

    async function resyncMarket(context) {
        if (!isEnabled()) return context.respond('Ticket Market is disabled.', { ephemeral: true });
        const missing = getMissingSettings(settings);
        if (missing.length) {
            return context.respond(`Ticket Market is not configured. Missing: ${missing.join(', ')}.`, {
                ephemeral: true,
            });
        }

        await context.deferUpdate();
        const activeAds = await runtime.resyncVisibility();
        log.info('Manually resynchronized Ticket Market visibility', {
            activeAds,
            actorId: getInteractionUser(context.interaction).id,
        });
        await context.respond('Ticket Market visibility resynchronized.', { ephemeral: true });
    }

    async function refreshRulesMessage() {
        const message = buildRulesMessage(settings);
        if (settings.rulesMessage) {
            try {
                await rest.editMessage(settings.rulesMessage.channelId, settings.rulesMessage.messageId, message);
                log.debug('Updated Ticket Market rules message', settings.rulesMessage);
                return;
            } catch (error) {
                if (error?.cause?.status !== 404) throw error;
                log.warn('Could not update Ticket Market rules message; publishing replacement', {
                    error,
                    ...settings.rulesMessage,
                });
            }
        }

        const sent = await rest.sendMessage(settings.marketRulesChannel, message);
        const rulesMessage = { channelId: settings.marketRulesChannel, messageId: String(sent.id) };
        await persistSetting(SETTING_KEYS.rulesMessage, rulesMessage);
        log.info('Published Ticket Market rules message', rulesMessage);
    }

    async function clearRulesMessage() {
        const stored = settings.rulesMessage;
        if (stored) {
            try {
                await rest.deleteMessage(stored.channelId, stored.messageId, 'Ticket Market rules message moved');
            } catch (error) {
                log.warn('Could not delete old Ticket Market rules message', { error, ...stored });
            }
        }
        await persistSetting(SETTING_KEYS.rulesMessage, null);
        log.debug('Cleared stored Ticket Market rules message', stored);
    }

    async function apply(refreshRules = false) {
        const missing = getMissingSettings(settings);
        if (!isEnabled()) {
            if (!missing.length && (refreshRules || !settings.rulesMessage)) await refreshRulesMessage();
            log.debug('Applying Ticket Market configuration while disabled');
            await runtime.deactivate('feature disabled');
            return;
        }
        if (missing.length) {
            log.debug('Ticket Market configuration remains incomplete', { missing });
            await runtime.deactivate('incomplete configuration');
            return;
        }
        log.debug('Applying complete Ticket Market configuration');
        if (refreshRules || !settings.rulesMessage) await refreshRulesMessage();
        await runtime.activate();
    }

    async function resetMarketForSellerChannelChange(previous, channelId, context) {
        const result = await runtime.resetForSellerChannelChange();
        await persistSetting(SETTING_KEYS.sellerAdsChannel, channelId);
        await clearMarketOverwrite(previous, settings.marketAccessRole, 'Seller Ads channel changed');
        await apply();
        const actorId = getInteractionUser(context.interaction).id;
        log.info('Reset Ticket Market for Seller Ads channel change', {
            previousChannelId: previous,
            channelId,
            actorId,
            ...result,
        });
        await sendAdminLog('Seller Ads Channel Changed', [
            `**Previous:** <#${previous}>`,
            `**New:** <#${channelId}>`,
            `**Ads Cleared:** ${result.ads.toLocaleString()}`,
            `**Failed Message Deletions:** ${result.failedDeletes.toLocaleString()}`,
            `**Changed By:** <@${actorId}>`,
        ]);
    }

    async function clearMarketOverwrite(channelId, roleId, reason) {
        if (!channelId || !roleId) return;
        try {
            await rest.deleteChannelPermissionOverride(channelId, roleId, reason);
        } catch (error) {
            if (error?.cause?.status !== 404) {
                log.error('Could not clear obsolete Ticket Market channel overwrite', {
                    error,
                    channelId,
                    roleId,
                    reason,
                });
            }
        }
    }

    function renderSettings(pageId) {
        return features.get('ticketMarket').renderSettings(pageId);
    }

    function isEnabled() {
        const feature = features.get('ticketMarket');
        return Boolean(feature?.enabled && !feature.missing.length);
    }
}

function settingChangeData(key, previous, value) {
    return isRulesSetting(key)
        ? { previousLength: previous?.length ?? 0, valueLength: value.length }
        : { previous, value };
}

function settingChangeLines(key, previous, value) {
    if (isRulesSetting(key)) return [`**New Rules:**\n${value}`];
    if (key === SETTING_KEYS.adCooldown || key === SETTING_KEYS.availabilityTimeout) {
        return [`**Previous:** ${formatDuration(previous)}`, `**New:** ${formatDuration(value)}`];
    }
    return [`**Previous:** ${previous.toLocaleString()}`, `**New:** ${value.toLocaleString()}`];
}

function formatDuration(value) {
    return value ? `${(value / 60_000).toLocaleString()} minutes` : 'Disabled';
}

function isRulesSetting(key) {
    return key === SETTING_KEYS.marketRules || key === SETTING_KEYS.sellerRules;
}
