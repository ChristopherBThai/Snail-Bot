export const TicketMarketIDs = Object.freeze({
    AgreeMarketRules: 'ticket_market:agree_market_rules',
    AgreeSellerRules: 'ticket_market:agree_seller_rules',
    CloseAd: 'ticket_market:close_ad',
    ConfigureMarketRules: 'ticket_market:configure_market_rules',
    ConfigureMarketRulesModal: 'ticket_market:configure_market_rules_modal',
    ConfigurePrice: 'ticket_market:configure_price',
    ConfigurePriceModal: 'ticket_market:configure_price_modal',
    ConfigureSellerRules: 'ticket_market:configure_seller_rules',
    ConfigureSellerRulesModal: 'ticket_market:configure_seller_rules_modal',
    ConfigureTiming: 'ticket_market:configure_timing',
    ConfigureTimingModal: 'ticket_market:configure_timing_modal',
    PostAd: 'ticket_market:post_ad',
    PostAdModal: 'ticket_market:post_ad_modal',
    RepairControls: 'ticket_market:repair_controls',
    SetControlChannel: 'ticket_market:set_control_channel',
    SetLogChannel: 'ticket_market:set_log_channel',
    SetMarketAccessRole: 'ticket_market:set_market_access_role',
    SetSellerAdsChannel: 'ticket_market:set_seller_ads_channel',
    SetTicketTradingChannel: 'ticket_market:set_ticket_trading_channel',
    StillSelling: 'ticket_market:still_selling',
    AdNote: 'ticket_market:ad_note',
    AdPrice: 'ticket_market:ad_price',
    AdTickets: 'ticket_market:ad_tickets',
    AdCooldown: 'ticket_market:ad_cooldown',
    AvailabilityTimeout: 'ticket_market:availability_timeout',
    MarketRulesCopy: 'ticket_market:market_rules_copy',
    MaxPrice: 'ticket_market:max_price',
    SellerRulesCopy: 'ticket_market:seller_rules_copy',
    SettingValue: 'ticket_market:setting_value'
});

export const DefaultTicketMarketSettings = Object.freeze({
    marketRulesCopy: 'Replace me with the Ticket Market rules.',
    sellerRulesCopy: 'Replace me with the Seller Rules.',
    maxPrice: 2_000_000,
    adCooldown: 15 * 60 * 1000,
    availabilityTimeout: 15 * 60 * 1000,
    tradingLocked: true
});

export const TicketMarketPermissions = Object.freeze({
    ViewChannel: 1024n,
    SendMessages: 2048n
});
