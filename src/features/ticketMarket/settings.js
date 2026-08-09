import {
    ButtonStyle,
    ChannelType,
    ComponentType,
    SelectMenuDefaultValueType,
    SeparatorSpacingSize,
    TextInputStyle,
} from 'discord-api-types/v10';
import { getModalValue } from '../../discord/interactions.js';
import { getMessageJumpLink } from '../../discord/messages.js';

const MAX_AVAILABILITY_MINUTES = 7 * 24 * 60;
const MAX_RULES_LENGTH = 2_000;

export const DEFAULT_SETTINGS = Object.freeze({
    adCooldown: 15 * 60 * 1000,
    availabilityTimeout: 0,
    inventoryVerification: true,
    maxPrice: 2_000_000,
});

export const SETTING_KEYS = Object.freeze({
    adminLogChannel: 'adminLogChannel',
    adCooldown: 'adCooldown',
    availabilityTimeout: 'availabilityTimeout',
    rulesMessage: 'rulesMessage',
    inventoryVerification: 'inventoryVerification',
    marketAccessRole: 'marketAccessRole',
    marketRules: 'marketRules',
    marketRulesChannel: 'marketRulesChannel',
    marketWarnedRole: 'marketWarnedRole',
    maxPrice: 'maxPrice',
    sellerAccessRole: 'sellerAccessRole',
    sellerAdsChannel: 'sellerAdsChannel',
    sellerRules: 'sellerRules',
    ticketTradingChannel: 'ticketTradingChannel',
});

export const SETTINGS_IDS = Object.freeze({
    channel: 'ticketMarket:settingChannel:',
    edit: 'ticketMarket:editSetting:',
    input: 'ticketMarket:settingInput',
    inventory: 'ticketMarket:toggleInventory',
    modal: 'ticketMarket:settingModal:',
    repairRulesMessage: 'ticketMarket:repairRulesMessage',
    resyncMarket: 'ticketMarket:resync',
    role: 'ticketMarket:settingRole:',
});

const CHANNEL_SETTINGS = Object.freeze([
    SETTING_KEYS.marketRulesChannel,
    SETTING_KEYS.sellerAdsChannel,
    SETTING_KEYS.ticketTradingChannel,
    SETTING_KEYS.adminLogChannel,
]);
const ROLE_SETTINGS = Object.freeze([
    SETTING_KEYS.marketAccessRole,
    SETTING_KEYS.sellerAccessRole,
    SETTING_KEYS.marketWarnedRole,
]);
const REQUIRED_SETTINGS = Object.freeze([
    ...CHANNEL_SETTINGS,
    ...ROLE_SETTINGS,
    SETTING_KEYS.marketRules,
    SETTING_KEYS.sellerRules,
]);

const LABELS = Object.freeze({
    [SETTING_KEYS.marketRulesChannel]: 'Market Rules',
    [SETTING_KEYS.sellerAdsChannel]: 'Seller Ads',
    [SETTING_KEYS.ticketTradingChannel]: 'Ticket Trading',
    [SETTING_KEYS.adminLogChannel]: 'Admin Log',
    [SETTING_KEYS.marketAccessRole]: 'Market Access',
    [SETTING_KEYS.sellerAccessRole]: 'Seller Access',
    [SETTING_KEYS.marketWarnedRole]: 'Market Warned',
    [SETTING_KEYS.marketRules]: 'Market Rules',
    [SETTING_KEYS.sellerRules]: 'Seller Rules',
    [SETTING_KEYS.maxPrice]: 'Maximum Price',
    [SETTING_KEYS.adCooldown]: 'Ad Cooldown',
    [SETTING_KEYS.availabilityTimeout]: 'Availability Timeout',
});

export function buildOverview(settings, activeAds, enabled, guildId) {
    const missing = getMissingSettings(settings);
    const rulesMessage = settings.rulesMessage;
    return [
        text(
            `### Ticket Market\n` +
                `**Status:** ${missing.length ? `Incomplete · Missing ${missing.join(', ')}` : 'Configured'}\n` +
                `**Active Ads:** ${activeAds.toLocaleString()}\n` +
                `**Ticket Trading:** ${enabled && !missing.length && activeAds ? 'Open' : 'Closed'}\n` +
                `**Rules Message:** ${rulesMessage ? getMessageJumpLink({ guildId, ...rulesMessage }) : 'Not published'}`,
        ),
        spacer(),
        section(
            '### Rules Message\nPublish, update, or replace the Ticket Market rules message.',
            SETTINGS_IDS.repairRulesMessage,
            'Publish',
            Boolean(missing.length),
        ),
        spacer(false),
        section(
            '### Channel Visibility\nReapply Seller Ads and Ticket Trading access from the current market state.',
            SETTINGS_IDS.resyncMarket,
            'Resync',
            Boolean(missing.length || !enabled),
        ),
    ];
}

export function buildChannels(settings) {
    return [
        text('### Channels'),
        ...CHANNEL_SETTINGS.flatMap((key, index) => [
            ...(index ? [spacer(false)] : []),
            text(`-# ${LABELS[key]}`),
            channelSelect(key, settings[key]),
        ]),
    ];
}

export function buildRoles(settings) {
    return [
        text('### Roles\n-# Market and Seller Access must be normal roles without server permissions.'),
        ...ROLE_SETTINGS.flatMap((key, index) => [
            ...(index ? [spacer(false)] : []),
            text(`-# ${LABELS[key]}`),
            roleSelect(key, settings[key]),
        ]),
    ];
}

export function buildRules(settings) {
    return [
        section(
            `### Market Rules\n${settings.marketRules ?? 'Not configured'}`,
            `${SETTINGS_IDS.edit}${SETTING_KEYS.marketRules}`,
            'Edit',
        ),
        spacer(false),
        section(
            `### Seller Rules\n${settings.sellerRules ?? 'Not configured'}`,
            `${SETTINGS_IDS.edit}${SETTING_KEYS.sellerRules}`,
            'Edit',
        ),
    ];
}

export function buildAds(settings) {
    return [
        section(
            `### Maximum Price\n${settings.maxPrice.toLocaleString()} cowoncy per ticket`,
            `${SETTINGS_IDS.edit}${SETTING_KEYS.maxPrice}`,
            'Edit',
        ),
        spacer(false),
        section(
            `### Ad Cooldown\n${formatMinutes(settings.adCooldown)}`,
            `${SETTINGS_IDS.edit}${SETTING_KEYS.adCooldown}`,
            'Edit',
        ),
        spacer(false),
        section(
            `### Availability Expiration\n${formatMinutes(settings.availabilityTimeout)}`,
            `${SETTINGS_IDS.edit}${SETTING_KEYS.availabilityTimeout}`,
            'Edit',
        ),
        spacer(false),
        section(
            `### Inventory Verification\n${settings.inventoryVerification ? 'Enabled' : 'Disabled'}`,
            SETTINGS_IDS.inventory,
            settings.inventoryVerification ? 'Disable' : 'Enable',
        ),
    ];
}

export function buildSettingModal(key, value) {
    const rules = key === SETTING_KEYS.marketRules || key === SETTING_KEYS.sellerRules;
    const minutes = key === SETTING_KEYS.adCooldown || key === SETTING_KEYS.availabilityTimeout;
    return {
        title: LABELS[key],
        customId: `${SETTINGS_IDS.modal}${key}`,
        components: [
            {
                type: ComponentType.Label,
                label: minutes ? `${LABELS[key]} in minutes (0 disables)` : LABELS[key],
                component: {
                    type: ComponentType.TextInput,
                    customId: SETTINGS_IDS.input,
                    style: rules ? TextInputStyle.Paragraph : TextInputStyle.Short,
                    required: true,
                    ...(rules ? { maxLength: MAX_RULES_LENGTH } : {}),
                    ...(value === undefined ? {} : { value: minutes ? String(value / 60_000) : String(value) }),
                },
            },
        ],
    };
}

export function readSetting(interaction, key) {
    const value = String(getModalValue(interaction, SETTINGS_IDS.input) ?? '').trim();
    if (key === SETTING_KEYS.marketRules || key === SETTING_KEYS.sellerRules) {
        return value && value.length <= MAX_RULES_LENGTH
            ? { ok: true, value }
            : { ok: false, message: `Rules must contain 1–${MAX_RULES_LENGTH.toLocaleString()} characters.` };
    }

    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        return { ok: false, message: 'Enter a non-negative whole number.' };
    }
    if (key === SETTING_KEYS.maxPrice && number === 0) {
        return { ok: false, message: 'Maximum price must be a positive whole number.' };
    }
    if (key === SETTING_KEYS.availabilityTimeout && number > MAX_AVAILABILITY_MINUTES) {
        return {
            ok: false,
            message: `Availability cannot exceed ${MAX_AVAILABILITY_MINUTES.toLocaleString()} minutes.`,
        };
    }
    if (key === SETTING_KEYS.adCooldown || key === SETTING_KEYS.availabilityTimeout) {
        const milliseconds = number * 60_000;
        return Number.isSafeInteger(milliseconds)
            ? { ok: true, value: milliseconds }
            : { ok: false, message: 'That duration is too large.' };
    }
    return { ok: true, value: number };
}

export function getMissingSettings(settings) {
    return REQUIRED_SETTINGS.filter((key) => !settings[key]).map((key) => LABELS[key]);
}

export function getSettingLabel(key) {
    return LABELS[key];
}

export function isAccessRoleSetting(key) {
    return key === SETTING_KEYS.marketAccessRole || key === SETTING_KEYS.sellerAccessRole;
}

function channelSelect(key, value) {
    return {
        type: ComponentType.ActionRow,
        components: [
            {
                type: ComponentType.ChannelSelect,
                customId: `${SETTINGS_IDS.channel}${key}`,
                placeholder: `Choose ${LABELS[key]} channel`,
                channelTypes: [ChannelType.GuildText],
                ...(value ? { defaultValues: [{ id: value, type: SelectMenuDefaultValueType.Channel }] } : {}),
            },
        ],
    };
}

function roleSelect(key, value) {
    return {
        type: ComponentType.ActionRow,
        components: [
            {
                type: ComponentType.RoleSelect,
                customId: `${SETTINGS_IDS.role}${key}`,
                placeholder: `Choose ${LABELS[key]} role`,
                ...(value ? { defaultValues: [{ id: value, type: SelectMenuDefaultValueType.Role }] } : {}),
            },
        ],
    };
}

function section(content, customId, label, disabled = false) {
    return {
        type: ComponentType.Section,
        components: [text(content)],
        accessory: { type: ComponentType.Button, customId, label, style: ButtonStyle.Secondary, disabled },
    };
}

function text(content) {
    return { type: ComponentType.TextDisplay, content };
}

function spacer(divider = true) {
    return { type: ComponentType.Separator, divider, spacing: SeparatorSpacingSize.Small };
}

function formatMinutes(milliseconds) {
    return milliseconds ? `${(milliseconds / 60_000).toLocaleString()} minutes` : 'Disabled';
}
