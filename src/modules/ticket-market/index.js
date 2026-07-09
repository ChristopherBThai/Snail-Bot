import { buildModulePanel } from '../../commands/module.js';
import {
    accentContainer,
    actionButton,
    actionRow,
    ButtonStyle,
    ChannelType,
    channelSelect,
    componentsMessage,
    ephemeralText,
    label,
    roleSelect,
    section,
    separator,
    TextInputStyle,
    textDisplay,
    textInput
} from '../../systems/discord/components.js';
import { auth, lines } from '../../utils.js';
import { Module } from '../index.js';
import { DefaultTicketMarketSettings, TicketMarketIDs, TicketMarketPermissions } from './constants.js';
import { createTicketMarketData } from './data.js';

const TradingPermissions = TicketMarketPermissions.ViewChannel | TicketMarketPermissions.SendMessages;
const SellerAdsOpenPermissions = TicketMarketPermissions.ViewChannel;
const MillisecondsPerMinute = 60 * 1000;
export const TicketMarketPanelPages = Object.freeze({
    Access: 'access',
    Channels: 'channels',
    Overview: 'overview'
});
const ConfigKeys = Object.freeze({
    availabilityTimeout: 'availability_timeout',
    adCooldown: 'ad_cooldown',
    controlChannelID: 'control_channel',
    controlMessageID: 'control_message',
    logChannelID: 'log_channel',
    marketAccessRoleID: 'market_access_role',
    marketRulesCopy: 'market_rules_copy',
    maxPrice: 'max_price',
    sellerAdsChannelID: 'seller_ads_channel',
    sellerRulesCopy: 'seller_rules_copy',
    ticketTradingChannelID: 'ticket_trading_channel',
    tradingLocked: 'trading_locked'
});

export class TicketMarketModule extends Module {
    static LogTypes = Object.freeze({
        AdDeleted: 'ticket_market.ad_deleted',
        AdExpired: 'ticket_market.ad_expired',
        AdPosted: 'ticket_market.ad_posted',
        AvailabilityReset: 'ticket_market.availability_reset',
        ConfigLoaded: 'ticket_market.config_loaded',
        ConfigUpdated: 'ticket_market.config_updated',
        ControlMessagePublished: 'ticket_market.control_message_published',
        ControlMessageRepaired: 'ticket_market.control_message_repaired',
        InteractionRejected: 'ticket_market.interaction_rejected',
        MarketClosed: 'ticket_market.closed',
        MarketRulesAccepted: 'ticket_market.market_rules_accepted',
        SellerRulesAccepted: 'ticket_market.seller_rules_accepted',
        TradingLockUpdated: 'ticket_market.trading_lock_updated'
    });

    #availabilityTimers;
    #config;
    #data;
    #discord;
    #settings;

    constructor({ config, databases, logging }) {
        super({
            databases,
            id: 'ticket_market',
            name: 'Ticket Market',
            description: 'Manages ticket market rules access, Snail-posted seller ads, and trading availability.',
            logsLimit: config.modules.defaultLogsLimit,
            logging
        });

        this.#availabilityTimers = new Map();
        this.#config = config;
        this.#data = createTicketMarketData(databases);
        this.#settings = { ...DefaultTicketMarketSettings };

        this.addComponent(TicketMarketIDs.AgreeMarketRules, (context) => this.#agreeMarketRules(context));
        this.addComponent(TicketMarketIDs.AgreeSellerRules, (context) => this.#agreeSellerRules(context));
        this.addComponent(TicketMarketIDs.CloseAd, (context) => this.#closeAd(context));
        this.addComponent(
            TicketMarketIDs.ConfigureMarketRules,
            (context) => this.#openMarketRulesConfigModal(context),
            {
                allowDisabled: true,
                auth: auth.manager
            }
        );
        this.addComponent(TicketMarketIDs.ConfigurePrice, (context) => this.#openPriceConfigModal(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addComponent(
            TicketMarketIDs.ConfigureSellerRules,
            (context) => this.#openSellerRulesConfigModal(context),
            {
                allowDisabled: true,
                auth: auth.manager
            }
        );
        this.addComponent(TicketMarketIDs.ConfigureTiming, (context) => this.#openTimingConfigModal(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addComponent(TicketMarketIDs.RepairControls, (context) => this.#repairControls(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addComponent(
            TicketMarketIDs.SetControlChannel,
            (context) => this.#setChannelSetting(context, 'controlChannelID', 'rules and ad controls channel'),
            {
                allowDisabled: true,
                auth: auth.manager
            }
        );
        this.addComponent(
            TicketMarketIDs.SetLogChannel,
            (context) => this.#setChannelSetting(context, 'logChannelID', 'log channel'),
            {
                allowDisabled: true,
                auth: auth.manager
            }
        );
        this.addComponent(TicketMarketIDs.SetMarketAccessRole, (context) => this.#setMarketAccessRole(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addComponent(
            TicketMarketIDs.SetSellerAdsChannel,
            (context) => this.#setChannelSetting(context, 'sellerAdsChannelID', 'Seller Ads channel'),
            {
                allowDisabled: true,
                auth: auth.manager
            }
        );
        this.addComponent(
            TicketMarketIDs.SetTicketTradingChannel,
            (context) => this.#setChannelSetting(context, 'ticketTradingChannelID', 'Ticket Trading channel'),
            {
                allowDisabled: true,
                auth: auth.manager
            }
        );
        this.addComponent(TicketMarketIDs.PostAd, (context) => this.#openPostAdModal(context));
        this.addComponent(TicketMarketIDs.StillSelling, (context) => this.#stillSelling(context));
        this.addModal(TicketMarketIDs.ConfigureMarketRulesModal, (context) => this.#configureMarketRules(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addModal(TicketMarketIDs.ConfigurePriceModal, (context) => this.#configurePrice(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addModal(TicketMarketIDs.ConfigureSellerRulesModal, (context) => this.#configureSellerRules(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addModal(TicketMarketIDs.ConfigureTimingModal, (context) => this.#configureTiming(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addModal(TicketMarketIDs.PostAdModal, (context) => this.#postAd(context));
        this.addEvent('ready', (discord) => this.#onReady(discord));
        this.addEvent('message', (message, discord) => this.#onMessage(message, discord));
        this.addEvent('message_delete', (message, discord) => this.#onMessageDelete(message, discord));
    }

    inactiveMessage() {
        return 'Ticket Market is closed.';
    }

    async onEnable(context) {
        await this.#loadSettings();
        await this.#loadAvailabilityTimers();

        if (context) {
            await this.#openSellerAds(context, 'module_enabled');
            await this.#reconcileTradingLock(context, 'module_enabled', { force: true });
        }
    }

    async onDisable() {
        this.#clearAvailabilityTimers();

        if (!this.#discord) {
            this.logger.warn(this.constructor.LogTypes.MarketClosed, { reason: 'no_discord_context' });
            return;
        }

        await this.#closeMarketChannels(this.#discord, 'module_disabled');
        await this.#sendLog(this.#discord, 'Ticket Market was closed because the module was disabled.');
    }

    state() {
        return {
            ...super.state(),
            settings: sanitizeSettings(this.#settings),
            availabilityTimers: this.#availabilityTimers.size
        };
    }

    panelDefaultPageID() {
        return TicketMarketPanelPages.Overview;
    }

    panelPages() {
        return [
            {
                id: TicketMarketPanelPages.Overview,
                label: 'Overview',
                components: this.#overviewPanelComponents()
            },
            {
                id: TicketMarketPanelPages.Access,
                label: 'Access',
                components: this.#accessPanelComponents()
            },
            {
                id: TicketMarketPanelPages.Channels,
                label: 'Channels',
                components: this.#channelsPanelComponents()
            }
        ];
    }

    #overviewPanelComponents() {
        const rulesMessage = this.#settings.controlMessageID
            ? this.#messageLink(this.#settings.controlChannelID, this.#settings.controlMessageID)
            : 'Not posted yet.';

        return [
            textDisplay(
                lines(
                    '**Market Status**',
                    this.#settings.tradingLocked
                        ? 'Ticket Trading is hidden until a seller has an active ad.'
                        : 'Ticket Trading is open because at least one seller has an active ad.'
                )
            ),
            separator(),
            section(
                [
                    textDisplay(
                        lines(
                            '**Rules Message**',
                            rulesMessage,
                            this.#settings.controlChannelID
                                ? `Rules channel: <#${this.#settings.controlChannelID}>`
                                : 'Select a rules channel to post the controls message.'
                        )
                    )
                ],
                actionButton('Repair', TicketMarketIDs.RepairControls, { style: ButtonStyle.Primary })
            ),
            separator(),
            section(
                [
                    textDisplay(
                        lines('**Price**', `${this.#settings.maxPrice.toLocaleString()} cowoncy maximum per ticket.`)
                    )
                ],
                actionButton('Edit', TicketMarketIDs.ConfigurePrice)
            ),
            separator(),
            section(
                [
                    textDisplay(
                        lines(
                            '**Timing**',
                            `Ad cooldown: ${formatMinutes(this.#settings.adCooldown)}`,
                            `Seller check-in: ${formatMinutes(this.#settings.availabilityTimeout)}`
                        )
                    )
                ],
                actionButton('Edit', TicketMarketIDs.ConfigureTiming)
            ),
            separator(),
            section(
                [
                    textDisplay(
                        lines(
                            '**Market Rules**',
                            `${this.#settings.marketRulesCopy.length.toLocaleString()} characters.`
                        )
                    )
                ],
                actionButton('Edit', TicketMarketIDs.ConfigureMarketRules)
            ),
            separator(),
            section(
                [
                    textDisplay(
                        lines(
                            '**Seller Rules**',
                            `${this.#settings.sellerRulesCopy.length.toLocaleString()} characters.`
                        )
                    )
                ],
                actionButton('Edit', TicketMarketIDs.ConfigureSellerRules)
            )
        ];
    }

    #accessPanelComponents() {
        return [
            textDisplay(
                lines(
                    `**Market Access Role:** ${this.#settings.marketAccessRoleID ? `<@&${this.#settings.marketAccessRoleID}>` : 'Not set.'}`,
                    'Selected role must have no server permissions.'
                )
            ),
            actionRow(
                roleSelect(TicketMarketIDs.SetMarketAccessRole, {
                    defaultValues: this.#settings.marketAccessRoleID
                        ? [{ id: this.#settings.marketAccessRoleID, type: 'role' }]
                        : undefined,
                    placeholder: 'Choose market access role'
                })
            )
        ];
    }

    #channelsPanelComponents() {
        return [
            textDisplay(
                `**Rules Channel:** ${this.#settings.controlChannelID ? `<#${this.#settings.controlChannelID}>` : 'Not set.'}`
            ),
            actionRow(
                channelSelect(TicketMarketIDs.SetControlChannel, {
                    channelTypes: [ChannelType.GuildText],
                    defaultValues: this.#settings.controlChannelID
                        ? [{ id: this.#settings.controlChannelID, type: 'channel' }]
                        : undefined,
                    placeholder: 'Rules channel'
                })
            ),
            separator(),
            textDisplay(
                `**Seller Ads:** ${this.#settings.sellerAdsChannelID ? `<#${this.#settings.sellerAdsChannelID}>` : 'Not set.'}`
            ),
            actionRow(
                channelSelect(TicketMarketIDs.SetSellerAdsChannel, {
                    channelTypes: [ChannelType.GuildText],
                    defaultValues: this.#settings.sellerAdsChannelID
                        ? [{ id: this.#settings.sellerAdsChannelID, type: 'channel' }]
                        : undefined,
                    placeholder: 'Seller Ads channel'
                })
            ),
            separator(),
            textDisplay(
                `**Ticket Trading:** ${this.#settings.ticketTradingChannelID ? `<#${this.#settings.ticketTradingChannelID}>` : 'Not set.'}`
            ),
            actionRow(
                channelSelect(TicketMarketIDs.SetTicketTradingChannel, {
                    channelTypes: [ChannelType.GuildText],
                    defaultValues: this.#settings.ticketTradingChannelID
                        ? [{ id: this.#settings.ticketTradingChannelID, type: 'channel' }]
                        : undefined,
                    placeholder: 'Ticket Trading channel'
                })
            ),
            separator(),
            textDisplay(
                `**Ticket Market Logs:** ${this.#settings.logChannelID ? `<#${this.#settings.logChannelID}>` : 'Not set.'}`
            ),
            actionRow(
                channelSelect(TicketMarketIDs.SetLogChannel, {
                    channelTypes: [ChannelType.GuildText],
                    defaultValues: this.#settings.logChannelID
                        ? [{ id: this.#settings.logChannelID, type: 'channel' }]
                        : undefined,
                    placeholder: 'Ticket Market log channel'
                })
            )
        ];
    }

    async #loadSettings() {
        const settings = {};
        for (const [setting, configKey] of Object.entries(ConfigKeys)) {
            const value = await this.getConfig(configKey);
            if (value !== undefined) {
                settings[setting] = value;
            }
        }

        await this.#loadLegacyControlSettings(settings);
        this.#settings = normalizeSettings(settings);
        this.logger.info(this.constructor.LogTypes.ConfigLoaded, sanitizeSettings(this.#settings));
    }

    async #loadLegacyControlSettings(settings) {
        if (!settings.controlChannelID) {
            const channelID =
                (await this.getConfig('market_rules_channel')) ?? (await this.getConfig('seller_rules_channel'));
            if (channelID) {
                settings.controlChannelID = channelID;
                await this.setConfig(ConfigKeys.controlChannelID, channelID);
            }
        }

        if (!settings.controlMessageID) {
            const messageID = await this.getConfig('market_rules_message');
            if (messageID) {
                settings.controlMessageID = messageID;
                await this.setConfig(ConfigKeys.controlMessageID, messageID);
            }
        }
    }

    async #saveSettingsPatch(patch) {
        const settings = normalizeSettings({
            ...this.#settings,
            ...patch
        });

        for (const setting of Object.keys(patch)) {
            await this.setConfig(ConfigKeys[setting], Object.hasOwn(settings, setting) ? settings[setting] : null);
        }

        this.#settings = settings;
    }

    async #loadAvailabilityTimers() {
        this.#clearAvailabilityTimers();

        if (this.#settings.availabilityTimeout <= 0) {
            return;
        }

        for (const ad of await this.#data.loadActiveAds()) {
            if (ad.availableUntil) {
                this.#scheduleAvailability(ad);
            }
        }
    }

    async #onReady(discord) {
        this.#discord = discord;
        await this.#ensureControlMessage(discord, { reason: 'ready_controls' });
        await this.#openSellerAds(discord, 'ready');
        await this.#reconcileTradingLock(discord, 'ready', { force: true });
    }

    async #onMessage(message, discord) {
        if (getMessageChannelID(message) !== this.#settings.ticketTradingChannelID) {
            return;
        }

        const userID = message.author?.id;
        if (!userID || message.author?.bot) {
            return;
        }

        const ad = await this.#data.getActiveAdBySeller(userID);
        if (!ad) {
            return;
        }

        await this.#resetAvailability(discord, ad, 'ticket_trading_message');
    }

    async #onMessageDelete(message, discord) {
        const messageID = getMessageID(message);
        if (!messageID) {
            return;
        }

        const ad = await this.#data.endAdByMessageID(messageID, {
            deletedAt: Date.now(),
            deletedBy: 'unknown'
        });
        if (!ad) {
            return;
        }

        this.#clearAvailabilityTimer(messageID);
        await this.#data.createUserLog({
            userID: ad.sellerID,
            kind: 'ad.deleted_external',
            metadata: {
                messageID: ad.messageID,
                deletedBy: 'unknown',
                tickets: ad.tickets,
                price: ad.price,
                note: ad.note
            }
        });
        await this.#sendLog(discord, this.#buildAdDeletedLog(ad));
        await this.#reconcileTradingLock(discord, 'ad_message_deleted');
    }

    async #agreeMarketRules(context) {
        if (!context.userID || !context.guildID) {
            await context.respond(ephemeralText('I could not identify your server member.'));
            return;
        }

        if (!this.#settings.marketAccessRoleID) {
            await context.respond(ephemeralText('Ticket Market access is not configured yet.'));
            return;
        }

        if (await this.#data.isMarketBanned(context.userID)) {
            await context.respond(ephemeralText('You cannot access the Ticket Market.'));
            return;
        }

        const alreadyAgreed = await this.#data.hasMarketAgreement(context.userID);
        const alreadyHasRole = context.memberRoles.includes(this.#settings.marketAccessRoleID);
        if (alreadyAgreed && alreadyHasRole) {
            await context.respond(ephemeralText('You already accepted the Ticket Market rules.'));
            return;
        }

        try {
            await context.addGuildMemberRole(context.guildID, context.userID, this.#settings.marketAccessRoleID);
        } catch (error) {
            this.logger.warn(this.constructor.LogTypes.InteractionRejected, {
                error,
                reason: 'market_role_grant_failed',
                roleID: this.#settings.marketAccessRoleID,
                userID: context.userID
            });
            await context.respond(
                ephemeralText('I could not grant the market access role. Ask a manager to check the module settings.')
            );
            return;
        }

        if (alreadyAgreed) {
            await context.respond(ephemeralText('Your Ticket Market access role was restored.'));
            return;
        }

        await this.#data.saveMarketAgreement(context.userID, Date.now());
        await this.#data.createUserLog({
            userID: context.userID,
            actorID: context.userID,
            kind: 'market_rules.accepted'
        });
        this.logger.info(this.constructor.LogTypes.MarketRulesAccepted, { userID: context.userID });
        await this.#sendLog(context, `<@${context.userID}> (\`${context.userID}\`) accepted the Ticket Market rules.`);
        await context.respond(ephemeralText('You now have access to the Ticket Market.'));
    }

    async #agreeSellerRules(context) {
        if (!context.userID) {
            await context.respond(ephemeralText('I could not identify your user.'));
            return;
        }

        if (await this.#data.isMarketBanned(context.userID)) {
            await context.respond(ephemeralText('You cannot access the Ticket Market.'));
            return;
        }

        await this.#data.saveSellerAgreement(context.userID, Date.now());
        await this.#data.createUserLog({
            userID: context.userID,
            actorID: context.userID,
            kind: 'seller_rules.accepted'
        });
        this.logger.info(this.constructor.LogTypes.SellerRulesAccepted, { userID: context.userID });
        await this.#sendLog(context, `<@${context.userID}> (\`${context.userID}\`) accepted the seller rules.`);
        await context.respond(ephemeralText('You can now use the Ticket Market ad form.'));
    }

    async #openPostAdModal(context) {
        if (await this.#data.isMarketBanned(context.userID)) {
            await context.respond(ephemeralText('You cannot access the Ticket Market.'));
            return;
        }

        if (!(await this.#data.hasSellerAgreement(context.userID))) {
            await context.respond(ephemeralText('Agree to the seller rules before posting a ticket ad.'));
            return;
        }

        if (!this.#settings.sellerAdsChannelID) {
            await context.respond(ephemeralText('Seller Ads is not configured yet.'));
            return;
        }

        await context.openModal({
            title: 'Post Ticket Ad',
            custom_id: TicketMarketIDs.PostAdModal,
            components: [
                label('Wrapped tickets to sell', textInput(TicketMarketIDs.AdTickets, { placeholder: '3' })),
                label(
                    'Price per ticket',
                    textInput(TicketMarketIDs.AdPrice, { placeholder: String(this.#settings.maxPrice) }),
                    `Maximum ${this.#settings.maxPrice.toLocaleString()} cowoncy per ticket.`
                ),
                label(
                    'Optional note',
                    textInput(TicketMarketIDs.AdNote, {
                        placeholder: 'Ping me in Ticket Trading to buy.',
                        required: false,
                        style: TextInputStyle.Paragraph
                    })
                )
            ]
        });
    }

    async #postAd(context) {
        if (await this.#data.isMarketBanned(context.userID)) {
            await context.respond(ephemeralText('You cannot access the Ticket Market.'));
            return;
        }

        if (!(await this.#data.hasSellerAgreement(context.userID))) {
            await context.respond(ephemeralText('Agree to the seller rules before posting a ticket ad.'));
            return;
        }

        const draft = parseAdDraft(context.modalValues, { maxPrice: this.#settings.maxPrice });
        if (draft.error) {
            await context.respond(ephemeralText(draft.error));
            return;
        }

        const activeAd = await this.#data.getActiveAdBySeller(context.userID);
        if (activeAd) {
            await context.respond(ephemeralText('You already have an active ticket ad.'));
            return;
        }

        const lastAd = await this.#data.getLastAdBySeller(context.userID);
        const cooldownEndsAt = (lastAd?.postedAt ?? 0) + this.#settings.adCooldown;
        if (cooldownEndsAt > Date.now()) {
            await context.respond(ephemeralText(`You can post another ad <t:${Math.ceil(cooldownEndsAt / 1000)}:R>.`));
            return;
        }

        await context.defer({ ephemeral: true });
        const inventoryCount = await this.#data.getWrappedTicketCountByDiscordID(context.userID);
        if (inventoryCount < draft.tickets) {
            await context.editReply(
                ephemeralText(
                    `You only have ${inventoryCount.toLocaleString()} Wrapped Tickets, so I cannot post an ad for ${draft.tickets.toLocaleString()}.`
                )
            );
            return;
        }

        const postedAt = Date.now();
        const availableUntil = this.#getAvailableUntil(postedAt);
        const sent = await context.sendMessage(
            this.#settings.sellerAdsChannelID,
            this.#buildAdMessage({
                ...draft,
                availableUntil,
                sellerID: context.userID
            })
        );
        const ad = await this.#data.createAd({
            ...draft,
            availableUntil,
            messageID: String(sent.id),
            postedAt,
            sellerID: context.userID
        });

        this.#scheduleAvailability(ad);
        this.logger.info(this.constructor.LogTypes.AdPosted, getAdLogData(ad));
        await this.#data.createUserLog({
            userID: context.userID,
            actorID: context.userID,
            kind: 'ad.posted',
            metadata: {
                messageID: ad.messageID,
                tickets: ad.tickets,
                price: ad.price,
                note: ad.note
            }
        });
        await this.#sendLog(context, this.#buildAdPostedLog(ad));
        await this.#reconcileTradingLock(context, 'ad_posted');
        await context.editReply(
            ephemeralText(
                `Your ticket ad is live: ${this.#messageLink(this.#settings.sellerAdsChannelID, ad.messageID)}`
            )
        );
    }

    async #closeAd(context) {
        const messageID = getMessageID(context.interaction.message);
        const ad = messageID ? await this.#data.getActiveAdByMessageID(messageID) : undefined;
        if (!ad) {
            await context.respond(ephemeralText('I could not find an active ticket ad for this message.'));
            return;
        }

        if (ad.sellerID !== context.userID && !(await auth.helper(context))) {
            await context.respond(ephemeralText('Only the seller or helpers can delete this ad.'));
            return;
        }

        const ended = await this.#endAd(context, ad, {
            deletedAt: Date.now(),
            deletedBy: context.userID,
            deleteMessage: true,
            reason: 'manual_delete'
        });
        await context.respond(
            ephemeralText(ended ? 'The ticket ad was deleted.' : 'That ticket ad is already closed.')
        );
    }

    async #stillSelling(context) {
        const messageID = getMessageID(context.interaction.message);
        const ad = messageID ? await this.#data.getActiveAdByMessageID(messageID) : undefined;
        if (!ad) {
            await context.respond(ephemeralText('I could not find an active ticket ad for this message.'));
            return;
        }

        if (ad.sellerID !== context.userID) {
            await context.respond(ephemeralText('Only the seller can refresh this ad.'));
            return;
        }

        await this.#resetAvailability(context, ad, 'still_selling_button');
        await context.respond(ephemeralText('Your ad timer was refreshed.'));
    }

    async #repairControls(context) {
        await context.defer({ ephemeral: true });
        const repaired = await this.#ensureControlMessage(context, {
            reason: 'manager_repair_controls',
            respondOnMissing: true
        });
        if (repaired) {
            await context.editReply(ephemeralText('Rules and ad controls message repaired.'));
        }
    }

    async #openPriceConfigModal(context) {
        await context.openModal({
            title: 'Ticket Market Price',
            custom_id: TicketMarketIDs.ConfigurePriceModal,
            components: [
                label(
                    'Max price per ticket',
                    textInput(TicketMarketIDs.MaxPrice, { value: String(this.#settings.maxPrice) })
                )
            ]
        });
    }

    async #openTimingConfigModal(context) {
        await context.openModal({
            title: 'Ticket Market Timing',
            custom_id: TicketMarketIDs.ConfigureTimingModal,
            components: [
                label(
                    'Ad cooldown minutes',
                    textInput(TicketMarketIDs.AdCooldown, {
                        value: String(this.#settings.adCooldown / MillisecondsPerMinute)
                    })
                ),
                label(
                    'Availability timeout minutes',
                    textInput(TicketMarketIDs.AvailabilityTimeout, {
                        value: String(this.#settings.availabilityTimeout / MillisecondsPerMinute)
                    })
                )
            ]
        });
    }

    async #openMarketRulesConfigModal(context) {
        await context.openModal({
            title: 'Market Rules Copy',
            custom_id: TicketMarketIDs.ConfigureMarketRulesModal,
            components: [
                label(
                    'Market rules copy',
                    textInput(TicketMarketIDs.MarketRulesCopy, {
                        value: this.#settings.marketRulesCopy,
                        style: TextInputStyle.Paragraph
                    })
                )
            ]
        });
    }

    async #openSellerRulesConfigModal(context) {
        await context.openModal({
            title: 'Seller Rules Copy',
            custom_id: TicketMarketIDs.ConfigureSellerRulesModal,
            components: [
                label(
                    'Seller rules copy',
                    textInput(TicketMarketIDs.SellerRulesCopy, {
                        value: this.#settings.sellerRulesCopy,
                        style: TextInputStyle.Paragraph
                    })
                )
            ]
        });
    }

    async #configurePrice(context) {
        const maxPrice = getModalPositiveInteger(context, TicketMarketIDs.MaxPrice);
        if (!maxPrice) {
            await context.respond(ephemeralText('Use a valid positive max price.'));
            return;
        }

        await this.#saveSettingsPatch({ maxPrice });
        this.logger.info(this.constructor.LogTypes.ConfigUpdated, { setting: 'maxPrice', maxPrice });
        await context.edit(this.#buildModulePanel(context, TicketMarketPanelPages.Overview));
    }

    async #configureTiming(context) {
        const cooldownMinutes = getModalNonNegativeInteger(context, TicketMarketIDs.AdCooldown);
        const availabilityMinutes = getModalNonNegativeInteger(context, TicketMarketIDs.AvailabilityTimeout);

        if (cooldownMinutes === undefined || availabilityMinutes === undefined) {
            await context.respond(ephemeralText('Use valid zero or positive timing values.'));
            return;
        }

        await this.#saveSettingsPatch({
            adCooldown: cooldownMinutes * MillisecondsPerMinute,
            availabilityTimeout: availabilityMinutes * MillisecondsPerMinute
        });
        await this.#loadAvailabilityTimers();
        this.logger.info(this.constructor.LogTypes.ConfigUpdated, {
            adCooldown: this.#settings.adCooldown,
            availabilityTimeout: this.#settings.availabilityTimeout,
            setting: 'timing'
        });
        await context.edit(this.#buildModulePanel(context, TicketMarketPanelPages.Overview));
    }

    async #configureMarketRules(context) {
        const marketRulesCopy = getModalString(context, TicketMarketIDs.MarketRulesCopy);
        if (!marketRulesCopy) {
            await context.respond(ephemeralText('Market rules copy cannot be empty.'));
            return;
        }

        await this.#saveSettingsPatch({ marketRulesCopy });
        await this.#ensureControlMessage(context, { reason: 'market_rules_updated' });
        this.logger.info(this.constructor.LogTypes.ConfigUpdated, {
            contentLength: marketRulesCopy.length,
            setting: 'marketRulesCopy'
        });
        await context.edit(this.#buildModulePanel(context, TicketMarketPanelPages.Overview));
    }

    async #configureSellerRules(context) {
        const sellerRulesCopy = getModalString(context, TicketMarketIDs.SellerRulesCopy);
        if (!sellerRulesCopy) {
            await context.respond(ephemeralText('Seller rules copy cannot be empty.'));
            return;
        }

        await this.#saveSettingsPatch({ sellerRulesCopy });
        await this.#ensureControlMessage(context, { reason: 'seller_rules_updated' });
        this.logger.info(this.constructor.LogTypes.ConfigUpdated, {
            contentLength: sellerRulesCopy.length,
            setting: 'sellerRulesCopy'
        });
        await context.edit(this.#buildModulePanel(context, TicketMarketPanelPages.Overview));
    }

    async #setChannelSetting(context, setting, label) {
        const channelID = context.data.values?.[0];
        if (!channelID) {
            await context.respond(ephemeralText(`Choose a valid ${label}.`));
            return;
        }

        await this.#saveSettingsPatch({ [setting]: channelID });

        if (setting === 'controlChannelID') {
            await this.#ensureControlMessage(context, { reason: 'control_channel_configured' });
        }
        if (setting === 'sellerAdsChannelID') {
            await this.#openSellerAds(context, 'seller_ads_configured');
        }
        if (setting === 'ticketTradingChannelID') {
            await this.#reconcileTradingLock(context, 'ticket_trading_configured', { force: true });
        }

        this.logger.info(this.constructor.LogTypes.ConfigUpdated, { setting, value: channelID });
        await this.#updateModulePanel(context, `Set ${label} to <#${channelID}>.`, TicketMarketPanelPages.Channels);
    }

    async #setMarketAccessRole(context) {
        const roleID = context.data.values?.[0];
        if (!roleID) {
            await context.respond(ephemeralText('Choose a valid market access role.'));
            return;
        }

        const roleValidation = validateMarketAccessRole(context.resolvedRoles?.[roleID]);
        if (roleValidation.error) {
            await context.respond(ephemeralText(roleValidation.error));
            return;
        }

        await this.#saveSettingsPatch({ marketAccessRoleID: roleID });
        await this.#openSellerAds(context, 'market_role_configured');
        await this.#reconcileTradingLock(context, 'market_role_configured', { force: true });
        this.logger.info(this.constructor.LogTypes.ConfigUpdated, { setting: 'marketAccessRoleID', value: roleID });
        await this.#updateModulePanel(
            context,
            `Set the market access role to <@&${roleID}>.`,
            TicketMarketPanelPages.Access
        );
    }

    async #ensureControlMessage(context, { reason, respondOnMissing = false }) {
        const channelID = this.#settings.controlChannelID;
        if (!channelID) {
            this.logger.warn(this.constructor.LogTypes.ControlMessageRepaired, { reason, skipped: 'missing_channel' });
            if (respondOnMissing) {
                await context.editReply(ephemeralText('Set the rules and ad controls channel first.'));
            }
            return;
        }

        const message = this.#buildControlsMessage();
        const savedMessageID = this.#settings.controlMessageID;
        if (savedMessageID) {
            try {
                await context.editMessage(channelID, savedMessageID, message);
                this.logger.info(this.constructor.LogTypes.ControlMessageRepaired, {
                    channelID,
                    messageID: savedMessageID,
                    reason
                });
                return savedMessageID;
            } catch (error) {
                this.logger.warn(this.constructor.LogTypes.ControlMessageRepaired, {
                    channelID,
                    error,
                    messageID: savedMessageID,
                    reason: `${reason}_edit_failed`
                });
            }
        }

        const sent = await context.sendMessage(channelID, message);
        this.#settings.controlMessageID = String(sent.id);
        await this.setConfig(ConfigKeys.controlMessageID, this.#settings.controlMessageID);
        this.logger.info(this.constructor.LogTypes.ControlMessagePublished, {
            channelID,
            messageID: this.#settings.controlMessageID,
            reason
        });

        return this.#settings.controlMessageID;
    }

    async #reconcileTradingLock(context, reason, { force = false } = {}) {
        if (!this.#settings.ticketTradingChannelID || !this.#settings.marketAccessRoleID) {
            return;
        }

        const activeAds = await this.#data.loadActiveAds();
        const shouldLock = activeAds.length === 0;
        if (!force && this.#settings.tradingLocked === shouldLock) {
            return;
        }

        try {
            await context.setChannelRoleOverwrite(
                this.#settings.ticketTradingChannelID,
                this.#settings.marketAccessRoleID,
                {
                    allow: shouldLock ? 0n : TradingPermissions,
                    deny: shouldLock ? TradingPermissions : 0n
                }
            );
        } catch (error) {
            this.logger.warn(this.constructor.LogTypes.TradingLockUpdated, {
                error,
                reason,
                skipped: 'permission_overwrite_failed'
            });
            return;
        }
        this.#settings.tradingLocked = shouldLock;
        await this.setConfig(ConfigKeys.tradingLocked, shouldLock);
        this.logger.info(this.constructor.LogTypes.TradingLockUpdated, {
            activeAdCount: activeAds.length,
            locked: shouldLock,
            reason
        });
        await this.#sendLog(
            context,
            `Ticket Trading ${shouldLock ? 'locked' : 'unlocked'} because ${activeAds.length} active ticket ads exist.`
        );
    }

    async #openSellerAds(context, reason) {
        if (!this.#settings.sellerAdsChannelID || !this.#settings.marketAccessRoleID) {
            return;
        }

        try {
            await context.setChannelRoleOverwrite(
                this.#settings.sellerAdsChannelID,
                this.#settings.marketAccessRoleID,
                {
                    allow: SellerAdsOpenPermissions,
                    deny: 0n
                }
            );
        } catch (error) {
            this.logger.warn(this.constructor.LogTypes.TradingLockUpdated, {
                channelID: this.#settings.sellerAdsChannelID,
                error,
                reason: `${reason}_seller_ads`,
                skipped: 'permission_overwrite_failed'
            });
            return;
        }
        this.logger.info(this.constructor.LogTypes.TradingLockUpdated, {
            channelID: this.#settings.sellerAdsChannelID,
            locked: false,
            reason: `${reason}_seller_ads`
        });
    }

    async #closeMarketChannels(context, reason) {
        if (!this.#settings.marketAccessRoleID) {
            return;
        }

        for (const channelID of [this.#settings.sellerAdsChannelID, this.#settings.ticketTradingChannelID].filter(
            Boolean
        )) {
            try {
                await context.setChannelRoleOverwrite(channelID, this.#settings.marketAccessRoleID, {
                    allow: 0n,
                    deny: TradingPermissions
                });
            } catch (error) {
                this.logger.warn(this.constructor.LogTypes.MarketClosed, {
                    channelID,
                    error,
                    reason,
                    skipped: 'permission_overwrite_failed'
                });
            }
        }

        this.#settings.tradingLocked = true;
        await this.setConfig(ConfigKeys.tradingLocked, true);
        this.logger.info(this.constructor.LogTypes.MarketClosed, { reason });
    }

    async #resetAvailability(context, ad, reason) {
        if (this.#settings.availabilityTimeout <= 0) {
            return;
        }

        const availableUntil = this.#getAvailableUntil(Date.now());
        const updated = await this.#data.resetAvailability(ad.messageID, availableUntil);
        if (!updated) {
            return;
        }

        this.#scheduleAvailability(updated);
        await context.editMessage(this.#settings.sellerAdsChannelID, updated.messageID, this.#buildAdMessage(updated));
        this.logger.info(this.constructor.LogTypes.AvailabilityReset, {
            availableUntil,
            messageID: updated.messageID,
            reason,
            sellerID: updated.sellerID
        });
    }

    #scheduleAvailability(ad) {
        this.#clearAvailabilityTimer(ad.messageID);

        if (!ad.availableUntil || this.#settings.availabilityTimeout <= 0) {
            return;
        }

        const delay = Math.max(0, ad.availableUntil - Date.now());
        this.#availabilityTimers.set(
            ad.messageID,
            setTimeout(() => {
                void this.#expireAd(ad.messageID);
            }, delay)
        );
    }

    async #expireAd(messageID) {
        if (!this.#discord) {
            return;
        }

        const ad = await this.#data.getActiveAdByMessageID(messageID);
        if (!ad?.availableUntil || ad.availableUntil > Date.now()) {
            if (ad) {
                this.#scheduleAvailability(ad);
            }
            return;
        }

        const ended = await this.#endAd(this.#discord, ad, {
            deletedAt: Date.now(),
            deletedBy: 'availability_timeout',
            deleteMessage: true,
            reason: 'availability_timeout'
        });
        if (ended) {
            this.logger.info(this.constructor.LogTypes.AdExpired, getAdLogData(ended));
        }
    }

    async #endAd(context, ad, { deletedAt, deletedBy, deleteMessage, reason }) {
        const ended = await this.#data.endAdByMessageID(ad.messageID, { deletedAt, deletedBy });
        if (!ended) {
            return undefined;
        }

        this.#clearAvailabilityTimer(ad.messageID);
        if (deleteMessage) {
            await context.deleteMessage(this.#settings.sellerAdsChannelID, ad.messageID).catch((error) => {
                this.logger.warn(this.constructor.LogTypes.AdDeleted, {
                    error,
                    messageID: ad.messageID,
                    reason: `${reason}_delete_failed`
                });
            });
        }

        this.logger.info(this.constructor.LogTypes.AdDeleted, getAdLogData(ended));
        await this.#data.createUserLog({
            userID: ended.sellerID,
            actorID: deletedBy === 'availability_timeout' ? undefined : deletedBy,
            kind: reason === 'availability_timeout' ? 'ad.expired' : 'ad.deleted',
            metadata: {
                messageID: ended.messageID,
                deletedBy,
                reason,
                tickets: ended.tickets,
                price: ended.price,
                note: ended.note
            }
        });
        await this.#sendLog(context, this.#buildAdDeletedLog(ended));
        await this.#reconcileTradingLock(context, reason);

        return ended;
    }

    #clearAvailabilityTimers() {
        for (const timer of this.#availabilityTimers.values()) {
            clearTimeout(timer);
        }

        this.#availabilityTimers.clear();
    }

    #clearAvailabilityTimer(messageID) {
        const timer = this.#availabilityTimers.get(messageID);
        if (timer) {
            clearTimeout(timer);
        }

        this.#availabilityTimers.delete(messageID);
    }

    #getAvailableUntil(now) {
        return this.#settings.availabilityTimeout > 0 ? now + this.#settings.availabilityTimeout : undefined;
    }

    #buildControlsMessage() {
        return componentsMessage(
            accentContainer(
                this.#config.colors.warning,
                section(
                    [textDisplay(lines('## Ticket Market Rules', this.#settings.marketRulesCopy))],
                    actionButton('Agree to Market Rules', TicketMarketIDs.AgreeMarketRules, {
                        style: ButtonStyle.Success
                    })
                ),
                separator(),
                section(
                    [textDisplay(lines('## Seller Rules', this.#settings.sellerRulesCopy))],
                    actionButton('Agree to Seller Rules', TicketMarketIDs.AgreeSellerRules, {
                        style: ButtonStyle.Success
                    })
                ),
                separator(),
                section(
                    [textDisplay('Post a Wrapped Ticket ad using Snail. You must agree to the seller rules first.')],
                    actionButton('Post Ticket Ad', TicketMarketIDs.PostAd, { style: ButtonStyle.Primary })
                )
            )
        );
    }

    #buildAdMessage({ availableUntil, note, price, sellerID, tickets }) {
        const total = price * tickets;
        const details = [
            '## Wrapped Ticket Ad',
            `Seller: <@${sellerID}> (\`${sellerID}\`)`,
            `Tickets: ${tickets.toLocaleString()}`,
            `Price per ticket: ${price.toLocaleString()} cowoncy`,
            `Total: ${total.toLocaleString()} cowoncy`,
            availableUntil ? `Available until: <t:${Math.ceil(availableUntil / 1000)}:R>` : undefined,
            '',
            'Ping the seller in Ticket Trading to buy.',
            note ? `Note: ${note}` : undefined
        ].filter((line) => line !== undefined);
        const buttons = [actionButton('Delete Ad', TicketMarketIDs.CloseAd, { style: ButtonStyle.Danger })];

        if (this.#settings.availabilityTimeout > 0) {
            buttons.push(actionButton('Still Selling', TicketMarketIDs.StillSelling, { style: ButtonStyle.Secondary }));
        }

        return componentsMessage(
            accentContainer(this.#config.colors.success, textDisplay(lines(...details).trim()), actionRow(...buttons))
        );
    }

    #buildAdPostedLog(ad) {
        const total = ad.price * ad.tickets;

        return lines(
            ...[
                `Ticket ad posted by <@${ad.sellerID}> (\`${ad.sellerID}\`).`,
                `Message ID: \`${ad.messageID}\``,
                `Tickets: ${ad.tickets.toLocaleString()}`,
                `Price: ${ad.price.toLocaleString()} each`,
                `Total: ${total.toLocaleString()}`,
                ad.note ? `Note: ${ad.note}` : undefined,
                `Posted: <t:${Math.ceil(ad.postedAt / 1000)}:F>`
            ].filter(Boolean)
        );
    }

    #buildAdDeletedLog(ad) {
        return lines(
            `Ticket ad deleted for <@${ad.sellerID}> (\`${ad.sellerID}\`).`,
            `Deleted by: ${ad.deletedBy === 'availability_timeout' ? 'availability timeout' : `<@${ad.deletedBy}>`} (\`${ad.deletedBy}\`)`,
            `Message ID: \`${ad.messageID}\``,
            `Posted: <t:${Math.ceil(ad.postedAt / 1000)}:F>`,
            `Ended: <t:${Math.ceil(ad.deletedAt / 1000)}:F>`
        );
    }

    async #sendLog(context, content) {
        if (!this.#settings.logChannelID) {
            return;
        }

        try {
            await context.sendMessage(this.#settings.logChannelID, content);
        } catch (error) {
            this.logger.warn('ticket_market.log_send_failed', {
                channelID: this.#settings.logChannelID,
                error
            });
        }
    }

    async #updateModulePanel(context, fallback, page = TicketMarketPanelPages.Overview) {
        try {
            await context.edit(this.#buildModulePanel(context, page));
        } catch {
            await context.respond(ephemeralText(fallback));
        }
    }

    #buildModulePanel(context, pageID = TicketMarketPanelPages.Overview) {
        return buildModulePanel(context, this, { pageID });
    }

    #messageLink(channelID, messageID) {
        return `https://discord.com/channels/${this.#config.discord.guildId}/${channelID}/${messageID}`;
    }
}

export function parseAdDraft(values, { maxPrice }) {
    const tickets = Number.parseInt(values[TicketMarketIDs.AdTickets], 10);
    const price = Number.parseInt(values[TicketMarketIDs.AdPrice], 10);
    const note = values[TicketMarketIDs.AdNote]?.trim() ?? '';

    if (!Number.isInteger(tickets) || tickets <= 0) {
        return { error: 'Enter a positive number of Wrapped Tickets.' };
    }

    if (!Number.isInteger(price) || price <= 0) {
        return { error: 'Enter a positive price per ticket.' };
    }

    if (price > maxPrice) {
        return { error: `Ticket ads cannot charge more than ${maxPrice.toLocaleString()} per ticket.` };
    }

    return { note, price, tickets };
}

export function validateMarketAccessRole(role) {
    if (!role) {
        return { error: 'I could not inspect that role. Try selecting the role again.' };
    }

    if (role.managed) {
        return { error: 'Choose a normal role. Managed roles cannot be used for Ticket Market access.' };
    }

    if (role.permissions === undefined || role.permissions === null) {
        return { error: 'I could not inspect that role permissions. Choose a role with no server permissions.' };
    }

    let permissions;
    try {
        permissions = BigInt(role.permissions);
    } catch {
        return { error: 'I could not inspect that role permissions. Choose a role with no server permissions.' };
    }

    if (permissions !== 0n) {
        return {
            error: 'Choose a role with no server permissions. Ticket Market access should only come from channel overwrites.'
        };
    }

    return {};
}

export function normalizeSettings(settings = {}) {
    return {
        ...DefaultTicketMarketSettings,
        ...getOptionalStringSettings(settings),
        maxPrice: getPositiveInteger(settings.maxPrice, DefaultTicketMarketSettings.maxPrice),
        adCooldown: getNonNegativeInteger(settings.adCooldown, DefaultTicketMarketSettings.adCooldown),
        availabilityTimeout: getNonNegativeInteger(
            settings.availabilityTimeout,
            DefaultTicketMarketSettings.availabilityTimeout
        ),
        tradingLocked: settings.tradingLocked !== false
    };
}

function getOptionalStringSettings(settings) {
    const normalized = {};

    for (const key of [
        'controlChannelID',
        'controlMessageID',
        'sellerAdsChannelID',
        'ticketTradingChannelID',
        'logChannelID',
        'marketAccessRoleID',
        'marketRulesCopy',
        'sellerRulesCopy'
    ]) {
        if (typeof settings[key] === 'string' && settings[key].trim()) {
            normalized[key] = settings[key].trim();
        }
    }

    return normalized;
}

function getModalString(context, id) {
    return typeof context.modalValues[id] === 'string' ? context.modalValues[id].trim() : '';
}

function getPositiveInteger(value, fallback) {
    const number = Number(value);

    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function getNonNegativeInteger(value, fallback) {
    const number = Number(value);

    return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function getModalPositiveInteger(context, id) {
    const value = Number.parseInt(getModalString(context, id), 10);

    return value > 0 ? value : undefined;
}

function getModalNonNegativeInteger(context, id) {
    const value = Number.parseInt(getModalString(context, id), 10);

    return value >= 0 ? value : undefined;
}

function getMessageChannelID(message) {
    return message.channel_id ?? message.channelId;
}

function getMessageID(message) {
    const messageID = message?.id ?? message?.message_id ?? message?.messageId;

    return messageID === undefined || messageID === null ? undefined : String(messageID);
}

function getAdLogData(ad) {
    return {
        availableUntil: ad.availableUntil,
        deletedAt: ad.deletedAt,
        deletedBy: ad.deletedBy,
        messageID: ad.messageID,
        note: ad.note,
        postedAt: ad.postedAt,
        price: ad.price,
        sellerID: ad.sellerID,
        tickets: ad.tickets
    };
}

function formatMinutes(milliseconds) {
    if (milliseconds === 0) {
        return 'disabled';
    }

    return `${milliseconds / MillisecondsPerMinute} minutes`;
}

function sanitizeSettings(settings) {
    return {
        ...settings,
        hasMarketRulesCopy: Boolean(settings.marketRulesCopy),
        hasSellerRulesCopy: Boolean(settings.sellerRulesCopy),
        marketRulesCopy: undefined,
        sellerRulesCopy: undefined
    };
}
