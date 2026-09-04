import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { COLORS } from '../../discord/colors.js';
import { createTicketMarketAccess } from './access.js';
import { createTicketMarketAds, DELETE_AD_MODAL_PREFIX, POST_AD_MODAL_ID } from './ads.js';
import { createTicketMarketConfiguration } from './configuration.js';
import {
    ACCEPT_MARKET_ID,
    ACCEPT_SELLER_ID,
    buildAdminLog,
    DELETE_AD_PREFIX,
    POST_AD_ID,
    STILL_SELLING_PREFIX,
} from './render.js';
import { createTicketMarketRuntime } from './runtime.js';
import { DEFAULT_SETTINGS, getMissingSettings, SETTINGS_IDS } from './settings.js';

const SETTING_NAMESPACE = 'ticketMarket';

/** @type {import('../../packages.js').PackageSetup} */
export default async function setup({ config, features, logging, rest, services }) {
    const log = logging.createLogger('ticketMarket');
    const mongo = services.snail.mongo;
    const mysql = services.owo.mysql;
    const inventoryAvailable = Boolean(mysql);
    const settings = { ...DEFAULT_SETTINGS };
    if (mongo) {
        Object.assign(settings, await mongo.Setting.loadValues(SETTING_NAMESPACE));
        log.debug('Loaded Ticket Market settings', {
            missing: getMissingSettings(settings),
            inventoryVerification: settings.inventoryVerification,
            adCooldown: settings.adCooldown,
            availabilityTimeout: settings.availabilityTimeout,
            rulesMessage: settings.rulesMessage,
        });
    }

    const runtime = createTicketMarketRuntime({
        config,
        settings,
        log,
        mysql,
        rest,
        sendAdminLog,
        User: mongo?.User,
    });
    const configuration = createTicketMarketConfiguration({
        config,
        features,
        inventoryAvailable,
        log,
        persistSetting: saveSetting,
        rest,
        runtime,
        sendAdminLog,
        settings,
    });
    const access = createTicketMarketAccess({
        config,
        log,
        rest,
        sendAdminLog,
        settings,
    });
    const ads = createTicketMarketAds({
        config,
        getAccessUnavailableMessage: access.getUnavailableMessage,
        inventoryAvailable,
        log,
        runtime,
        settings,
    });

    async function saveSetting(key, value) {
        await mongo.Setting.saveValue(SETTING_NAMESPACE, key, value);
        settings[key] = value;
    }

    async function sendAdminLog(title, lines, accentColor = COLORS.neutral) {
        const channelId = settings.adminLogChannel;
        if (!channelId) return;
        try {
            await rest.sendMessage(channelId, buildAdminLog(title, lines, accentColor));
            log.trace('Sent Ticket Market admin log', { title, channelId });
        } catch (error) {
            log.error('Could not send Ticket Market admin log', {
                error,
                title,
                channelId,
            });
        }
    }

    return {
        name: 'Ticket Market',
        missing: mongo ? [] : ['Snail Mongo'],
        components: [
            interaction(ACCEPT_MARKET_ID, access.acceptMarketRules),
            interaction(ACCEPT_SELLER_ID, access.acceptSellerRules),
            interaction(POST_AD_ID, ads.openPostAdModal),
            interaction(DELETE_AD_PREFIX, ads.openDeleteAd, { prefix: true }),
            interaction(STILL_SELLING_PREFIX, ads.stillSelling, { prefix: true }),
            interaction(SETTINGS_IDS.channel, configuration.setChannel, { prefix: true, manager: true }),
            interaction(SETTINGS_IDS.role, configuration.setRole, { prefix: true, manager: true }),
            interaction(SETTINGS_IDS.edit, configuration.openSettingModal, { prefix: true, manager: true }),
            interaction(SETTINGS_IDS.inventory, configuration.toggleInventory, { manager: true }),
            interaction(SETTINGS_IDS.repairRulesMessage, configuration.repairRulesMessage, { manager: true }),
            interaction(SETTINGS_IDS.resyncMarket, configuration.resyncMarket, { manager: true }),
        ],
        modals: [
            interaction(POST_AD_MODAL_ID, ads.postAd),
            interaction(DELETE_AD_MODAL_PREFIX, ads.deleteAdFromModal, { prefix: true }),
            interaction(SETTINGS_IDS.modal, configuration.saveSetting, { prefix: true, manager: true }),
        ],
        feature: {
            id: 'ticketMarket',
            description: 'Manages Ticket Market access, seller ads, and trading availability.',
            toggleable: true,
            activate: configuration.activate,
            deactivate: configuration.deactivate,
            events: [
                { event: GatewayDispatchEvents.MessageCreate, handle: runtime.messageCreated },
                { event: GatewayDispatchEvents.MessageDelete, handle: runtime.messageDeleted },
                { event: GatewayDispatchEvents.MessageDeleteBulk, handle: runtime.messageDeletedBulk },
            ],
            settings: {
                pages: [
                    { id: 'overview', label: 'Overview', render: configuration.renderOverview },
                    { id: 'channels', label: 'Channels', render: configuration.renderChannels },
                    { id: 'roles', label: 'Roles', render: configuration.renderRoles },
                    { id: 'rules', label: 'Rules', render: configuration.renderRules },
                    { id: 'ads', label: 'Ads', render: configuration.renderAds },
                ],
            },
        },
    };
}

function interaction(id, handle, { prefix = false, manager = false } = {}) {
    return {
        [prefix ? 'prefix' : 'id']: id,
        ...(manager ? { authorize: hasManagerAccess, availableWhenDisabled: true } : {}),
        handle,
    };
}
