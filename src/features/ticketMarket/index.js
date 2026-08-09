import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { getCustomIdSuffix, getInteractionUser, getSelectValue } from '../../discord/interactions.js';
import { createTicketMarketAds, DELETE_AD_MODAL_PREFIX, POST_AD_MODAL_ID } from './ads.js';
import {
    ACCEPT_MARKET_ID,
    ACCEPT_SELLER_ID,
    buildAdminLog,
    buildRulesMessage,
    DELETE_AD_PREFIX,
    POST_AD_ID,
    STILL_SELLING_PREFIX,
} from './render.js';
import { createTicketMarketRepository } from './repository.js';
import { createTicketMarketRuntime } from './runtime.js';
import {
    buildAds,
    buildChannels,
    buildOverview,
    buildRoles,
    buildRules,
    buildSettingModal,
    DEFAULT_SETTINGS,
    getMissingSettings,
    getSettingLabel,
    isAccessRoleSetting,
    readSetting,
    SETTING_KEYS,
    SETTINGS_IDS,
} from './settings.js';

/** @type {import('../../packages.js').PackageSetup} */
export default function setup({ config, features, logging, rest, services, unavailable }) {
    const log = logging.createLogger('ticketMarket');
    const repository =
        services.snail.mongo && services.owo.mysql
            ? createTicketMarketRepository({
                  Setting: services.snail.mongo.Setting,
                  User: services.snail.mongo.User,
                  mysql: services.owo.mysql,
              })
            : undefined;
    const runtime = createTicketMarketRuntime({
        config,
        getSettings: loadSettings,
        log,
        repository,
        rest,
        sendAdminLog,
    });
    const ads = createTicketMarketAds({
        config,
        getAccessUnavailable: accessUnavailable,
        getSettings: loadSettings,
        log,
        runtime,
    });
    let settings;

    return {
        name: 'Ticket Market',
        missing: [...(unavailable.snail.mongo ?? []), ...(unavailable.owo.mysql ?? [])],
        components: [
            interaction(ACCEPT_MARKET_ID, acceptMarketRules),
            interaction(ACCEPT_SELLER_ID, acceptSellerRules),
            interaction(POST_AD_ID, ads.openPostAdModal),
            interaction(DELETE_AD_PREFIX, ads.openDeleteAd, { prefix: true }),
            interaction(STILL_SELLING_PREFIX, ads.stillSelling, { prefix: true }),
            interaction(SETTINGS_IDS.channel, setChannel, { prefix: true, manager: true }),
            interaction(SETTINGS_IDS.role, setRole, { prefix: true, manager: true }),
            interaction(SETTINGS_IDS.edit, openSettingModal, { prefix: true, manager: true }),
            interaction(SETTINGS_IDS.inventory, toggleInventory, { manager: true }),
            interaction(SETTINGS_IDS.repairRulesMessage, repairRulesMessage, { manager: true }),
            interaction(SETTINGS_IDS.resyncMarket, resyncMarket, { manager: true }),
        ],
        modals: [
            interaction(POST_AD_MODAL_ID, ads.postAd),
            interaction(DELETE_AD_MODAL_PREFIX, ads.deleteAdFromModal, { prefix: true }),
            interaction(SETTINGS_IDS.modal, saveSetting, { prefix: true, manager: true }),
        ],
        feature: {
            id: 'ticketMarket',
            description: 'Manages Ticket Market access, seller ads, and trading availability.',
            toggleable: true,
            activate,
            deactivate,
            events: [
                { event: GatewayDispatchEvents.MessageCreate, handle: runtime.messageCreated },
                { event: GatewayDispatchEvents.MessageDelete, handle: runtime.messageDeleted },
                { event: GatewayDispatchEvents.MessageDeleteBulk, handle: runtime.messageDeletedBulk },
            ],
            settings: {
                pages: [
                    { id: 'overview', label: 'Overview', render: renderOverview },
                    { id: 'channels', label: 'Channels', render: renderChannels },
                    { id: 'roles', label: 'Roles', render: renderRoles },
                    { id: 'rules', label: 'Rules', render: renderRulesPage },
                    { id: 'ads', label: 'Ads', render: renderAds },
                ],
            },
        },
    };

    function interaction(id, handle, { prefix = false, manager = false } = {}) {
        return {
            [prefix ? 'prefix' : 'id']: id,
            ...(manager ? { authorize: hasManagerAccess, availableWhenDisabled: true } : {}),
            handle,
        };
    }

    async function activate() {
        const timer = log.time();
        const values = await loadSettings();
        timer.checkpoint('settings');
        const missing = getMissingSettings(values);
        if (missing.length) {
            await runtime.deactivate('incomplete configuration');
            timer.warn('Ticket Market configuration is incomplete', { missing });
            return;
        }

        await refreshRulesMessage();
        timer.checkpoint('rulesMessage');
        const activeAds = await runtime.activate();
        timer.checkpoint('runtime');
        timer.info('Ticket Market activated', { activeAds });
    }

    async function deactivate() {
        await runtime.deactivate('feature disabled');
    }

    async function loadSettings() {
        if (!settings) {
            settings = { ...DEFAULT_SETTINGS, ...(await repository.loadSettings()) };
            log.debug('Loaded Ticket Market settings', {
                missing: getMissingSettings(settings),
                inventoryVerification: settings.inventoryVerification,
                adCooldown: settings.adCooldown,
                availabilityTimeout: settings.availabilityTimeout,
                rulesMessage: settings.rulesMessage,
            });
        }
        return settings;
    }

    async function renderOverview() {
        const values = await loadSettings();
        return buildOverview(values, await runtime.getActiveAdCount(), isEnabled(), config.guildId);
    }

    async function renderChannels() {
        return buildChannels(await loadSettings());
    }

    async function renderRoles() {
        return buildRoles(await loadSettings());
    }

    async function renderRulesPage() {
        return buildRules(await loadSettings());
    }

    async function renderAds() {
        return buildAds(await loadSettings());
    }

    async function acceptMarketRules(context) {
        const values = await loadSettings();
        const unavailableMessage = accessUnavailable(context, values);
        if (unavailableMessage) return context.respond(unavailableMessage, { ephemeral: true });
        if (context.interaction.member.roles.includes(values.marketAccessRole)) {
            return context.respond('You already have Ticket Market access.', { ephemeral: true });
        }

        const userId = getInteractionUser(context.interaction).id;
        const timer = log.time();
        await context.defer({ ephemeral: true });
        await rest.addRole(config.guildId, userId, values.marketAccessRole, 'Accepted Ticket Market rules');
        timer.checkpoint('discord');
        await context.editResponse('Ticket Market access granted.');
        timer.checkpoint('response');
        timer.info('Accepted Ticket Market rules', { userId, roleId: values.marketAccessRole });
        await sendAdminLog('Market Rules Accepted', [`**User:** <@${userId}> (\`${userId}\`)`]);
    }

    async function acceptSellerRules(context) {
        const values = await loadSettings();
        const unavailableMessage = accessUnavailable(context, values);
        if (unavailableMessage) return context.respond(unavailableMessage, { ephemeral: true });
        if (!context.interaction.member.roles.includes(values.marketAccessRole)) {
            return context.respond('Accept the market rules before accepting the seller rules.', { ephemeral: true });
        }
        if (context.interaction.member.roles.includes(values.sellerAccessRole)) {
            return context.respond('You already have Ticket Market seller access.', { ephemeral: true });
        }

        const userId = getInteractionUser(context.interaction).id;
        const timer = log.time();
        await context.defer({ ephemeral: true });
        await rest.addRole(config.guildId, userId, values.sellerAccessRole, 'Accepted Ticket Market seller rules');
        timer.checkpoint('discord');
        await context.editResponse('Ticket Market seller access granted.');
        timer.checkpoint('response');
        timer.info('Accepted Ticket Market seller rules', { userId, roleId: values.sellerAccessRole });
        await sendAdminLog('Seller Rules Accepted', [`**User:** <@${userId}> (\`${userId}\`)`]);
    }

    async function setChannel(context) {
        const key = getCustomIdSuffix(context.interaction, SETTINGS_IDS.channel);
        const channelId = getSelectValue(context.interaction);
        if (!channelId) {
            return context.respond('Choose a valid channel.', { ephemeral: true });
        }

        await context.deferUpdate();
        const values = await loadSettings();
        const previous = values[key];
        if (key === SETTING_KEYS.sellerAdsChannel && previous && previous !== channelId) {
            await resetMarketForSellerChannelChange(context, previous, channelId);
        } else {
            if (key === SETTING_KEYS.marketRulesChannel && previous !== channelId) await clearRulesMessage();
            await saveSettingValue(key, channelId);
            if (key === SETTING_KEYS.ticketTradingChannel && previous !== channelId) {
                await clearMarketOverwrite(previous, values.marketAccessRole, 'Ticket Trading channel changed');
            }
            await applyConfigurationChange();
            const actorId = getInteractionUser(context.interaction).id;
            log.info('Changed Ticket Market channel', { key, previous, channelId, actorId });
            await sendAdminLog('Ticket Market Channel Changed', [
                `**Setting:** ${getSettingLabel(key)}`,
                `**Previous:** ${previous ? `<#${previous}>` : 'Not configured'}`,
                `**New:** <#${channelId}>`,
                `**Changed By:** <@${actorId}>`,
            ]);
        }
        await context.editResponse(await renderFeatureSettings('channels'));
    }

    async function setRole(context) {
        const key = getCustomIdSuffix(context.interaction, SETTINGS_IDS.role);
        const roleId = getSelectValue(context.interaction);
        const role = roleId && context.interaction.data.resolved?.roles?.[roleId];
        if (!role) {
            return context.respond('Choose a valid role.', { ephemeral: true });
        }
        if (role.managed || (isAccessRoleSetting(key) && BigInt(role.permissions ?? 0) !== 0n)) {
            const message = role.managed
                ? 'Choose a role that is not managed by an integration.'
                : 'Access roles cannot have server permissions.';
            return context.respond(message, { ephemeral: true });
        }

        await context.deferUpdate();
        const values = await loadSettings();
        const previous = values[key];
        await saveSettingValue(key, roleId);
        if (key === SETTING_KEYS.marketAccessRole && previous !== roleId) {
            await Promise.all(
                [values.sellerAdsChannel, values.ticketTradingChannel].map((channelId) =>
                    clearMarketOverwrite(channelId, previous, 'Ticket Market access role changed'),
                ),
            );
        }
        await applyConfigurationChange();
        const actorId = getInteractionUser(context.interaction).id;
        log.info('Changed Ticket Market role', { key, previous, roleId, actorId });
        await sendAdminLog('Ticket Market Role Changed', [
            `**Setting:** ${getSettingLabel(key)}`,
            `**Previous:** ${previous ? `<@&${previous}>` : 'Not configured'}`,
            `**New:** <@&${roleId}>`,
            `**Changed By:** <@${actorId}>`,
        ]);
        await context.editResponse(await renderFeatureSettings('roles'));
    }

    async function openSettingModal(context) {
        const key = getCustomIdSuffix(context.interaction, SETTINGS_IDS.edit);
        const values = await loadSettings();
        await context.openModal(buildSettingModal(key, values[key]));
    }

    async function saveSetting(context) {
        const key = getCustomIdSuffix(context.interaction, SETTINGS_IDS.modal);
        const parsed = readSetting(context.interaction, key);
        if (!parsed.ok) return context.respond(parsed.message, { ephemeral: true });

        await context.deferUpdate();
        const previous = (await loadSettings())[key];
        await saveSettingValue(key, parsed.value);
        if (key === SETTING_KEYS.availabilityTimeout) await runtime.updateAvailabilityTimeout(parsed.value);
        if (isRulesSetting(key)) await applyConfigurationChange(true);
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
        const page = isRulesSetting(key) ? 'rules' : 'ads';
        await context.editResponse(await renderFeatureSettings(page));
    }

    async function toggleInventory(context) {
        await context.deferUpdate();
        const value = !(await loadSettings()).inventoryVerification;
        await saveSettingValue(SETTING_KEYS.inventoryVerification, value);
        const actorId = getInteractionUser(context.interaction).id;
        log.info('Changed Ticket Market inventory verification', {
            enabled: value,
            actorId,
        });
        await sendAdminLog('Ticket Market Setting Changed', [
            '**Setting:** Inventory Verification',
            `**Previous:** ${value ? 'Disabled' : 'Enabled'}`,
            `**New:** ${value ? 'Enabled' : 'Disabled'}`,
            `**Changed By:** <@${actorId}>`,
        ]);
        await context.editResponse(await renderFeatureSettings('ads'));
    }

    async function repairRulesMessage(context) {
        const missing = getMissingSettings(await loadSettings());
        if (missing.length) {
            return context.respond(`Ticket Market is not configured. Missing: ${missing.join(', ')}.`, {
                ephemeral: true,
            });
        }
        await context.deferUpdate();
        await refreshRulesMessage();
        log.info('Repaired Ticket Market rules message', { actorId: getInteractionUser(context.interaction).id });
        await context.editResponse(await renderFeatureSettings('overview'));
    }

    async function resyncMarket(context) {
        if (!isEnabled()) return context.respond('Ticket Market is disabled.', { ephemeral: true });
        const missing = getMissingSettings(await loadSettings());
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
        const values = await loadSettings();
        const message = buildRulesMessage(values);
        const stored = values.rulesMessage;
        if (stored) {
            try {
                await rest.editMessage(stored.channelId, stored.messageId, message);
                log.debug('Updated Ticket Market rules message', stored);
                return;
            } catch (error) {
                if (error?.cause?.status !== 404) throw error;
                log.warn('Could not update Ticket Market rules message; publishing replacement', { error, ...stored });
            }
        }

        const sent = await rest.sendMessage(values.marketRulesChannel, message);
        const rulesMessage = { channelId: values.marketRulesChannel, messageId: String(sent.id) };
        await saveSettingValue(SETTING_KEYS.rulesMessage, rulesMessage);
        log.info('Published Ticket Market rules message', rulesMessage);
    }

    async function clearRulesMessage() {
        const stored = (await loadSettings()).rulesMessage;
        if (stored) {
            try {
                await rest.deleteMessage(stored.channelId, stored.messageId, 'Ticket Market rules message moved');
            } catch (error) {
                log.warn('Could not delete old Ticket Market rules message', { error, ...stored });
            }
        }
        await saveSettingValue(SETTING_KEYS.rulesMessage, null);
        log.debug('Cleared stored Ticket Market rules message', stored);
    }

    async function applyConfigurationChange(refreshRules = false) {
        const values = await loadSettings();
        const missing = getMissingSettings(values);
        if (!isEnabled()) {
            if (!missing.length && (refreshRules || !values.rulesMessage)) await refreshRulesMessage();
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
        if (refreshRules || !values.rulesMessage) await refreshRulesMessage();
        await runtime.activate();
    }

    async function resetMarketForSellerChannelChange(context, previous, channelId) {
        const result = await runtime.resetForSellerChannelChange();
        const marketAccessRole = (await loadSettings()).marketAccessRole;
        await saveSettingValue(SETTING_KEYS.sellerAdsChannel, channelId);
        await clearMarketOverwrite(previous, marketAccessRole, 'Seller Ads channel changed');
        await applyConfigurationChange();
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

    async function saveSettingValue(key, value) {
        await repository.saveSetting(key, value);
        settings = { ...settings, [key]: value };
    }

    async function sendAdminLog(title, lines) {
        const channelId = (await loadSettings()).adminLogChannel;
        if (!channelId) return;
        try {
            await rest.sendMessage(channelId, buildAdminLog(title, lines));
            log.trace('Sent Ticket Market admin log', { title, channelId });
        } catch (error) {
            log.error('Could not send Ticket Market admin log', { error, title, channelId });
        }
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

    function accessUnavailable(context, values) {
        const missing = getMissingSettings(values);
        if (missing.length) {
            log.trace('Denied Ticket Market access for incomplete configuration', {
                userId: getInteractionUser(context.interaction).id,
                missing,
            });
            return `Ticket Market is not configured. Missing: ${missing.join(', ')}.`;
        }
        if (context.interaction.member.roles.includes(values.marketWarnedRole)) {
            log.debug('Denied Ticket Market access to warned user', {
                userId: getInteractionUser(context.interaction).id,
            });
            return 'Ticket Market access is not available for your account.';
        }
    }

    function renderFeatureSettings(pageId) {
        return features.get('ticketMarket').renderSettings(pageId);
    }

    function isEnabled() {
        const feature = features.get('ticketMarket');
        return Boolean(feature?.available && feature.enabled);
    }
}

function settingChangeData(key, previous, value) {
    if (isRulesSetting(key)) {
        return { previousLength: previous?.length ?? 0, valueLength: value.length };
    }
    return { previous, value };
}

function settingChangeLines(key, previous, value) {
    if (isRulesSetting(key)) {
        return [`**New Rules:**\n${value}`];
    }
    if (key === SETTING_KEYS.adCooldown || key === SETTING_KEYS.availabilityTimeout) {
        return [`**Previous:** ${formatDurationSetting(previous)}`, `**New:** ${formatDurationSetting(value)}`];
    }
    return [`**Previous:** ${previous.toLocaleString()}`, `**New:** ${value.toLocaleString()}`];
}

function formatDurationSetting(value) {
    return value ? `${(value / 60_000).toLocaleString()} minutes` : 'Disabled';
}

function isRulesSetting(key) {
    return key === SETTING_KEYS.marketRules || key === SETTING_KEYS.sellerRules;
}
