import { ButtonStyle, ComponentType, MessageFlags, SeparatorSpacingSize } from 'discord-api-types/v10';
import { suppressMentions } from '../../discord/messages.js';

export const ACCEPT_MARKET_ID = 'ticketMarket:acceptMarket';
export const ACCEPT_SELLER_ID = 'ticketMarket:acceptSeller';
export const POST_AD_ID = 'ticketMarket:postAd';
export const DELETE_AD_PREFIX = 'ticketMarket:deleteAd:';
export const STILL_SELLING_PREFIX = 'ticketMarket:stillSelling:';

export function buildRulesMessage(settings) {
    return message([
        text(
            '## Ticket Market Rules\nFailure to follow these rules may result in Ticket Market punishments. Staff members reserve the right to interpret misuse of the Ticket Market channels and enforce these rules.',
        ),
        separator(),
        section(`### Market Rules\n${settings.marketRules}`, ACCEPT_MARKET_ID, 'Accept'),
        separator(),
        section(`### Seller Rules\n${settings.sellerRules}`, ACCEPT_SELLER_ID, 'Accept'),
        separator(),
        section('### Sell Wrapped Tickets\nCreate an advertisement in Seller Ads.', POST_AD_ID, 'Post Ad'),
    ]);
}

export function buildSellerAdMessage(ad) {
    const availabilityEnabled = Boolean(ad.availabilityDeadline);
    const details = [
        `**Price:** ${ad.price.toLocaleString()}`,
        `**Stock:** ${ad.ticketCount.toLocaleString()}`,
        ...(availabilityEnabled
            ? [`**Available Until:** <t:${Math.floor(new Date(ad.availabilityDeadline).getTime() / 1000)}:R>`]
            : []),
        ...(ad.note ? [`\n${ad.note}`] : []),
    ];

    return {
        allowedMentions: { users: [ad.sellerId] },
        flags: MessageFlags.IsComponentsV2,
        components: [
            {
                type: ComponentType.Container,
                ...(ad.accentColor === undefined ? {} : { accentColor: ad.accentColor }),
                components: [
                    text(`## <@${ad.sellerId}>'s Ticket Ad\n${details.join('\n')}`),
                    separator(),
                    {
                        type: ComponentType.ActionRow,
                        components: [
                            button('Delete Ad', `${DELETE_AD_PREFIX}${ad.sellerId}`, ButtonStyle.Danger),
                            ...(availabilityEnabled
                                ? [
                                      button(
                                          'Still Selling',
                                          `${STILL_SELLING_PREFIX}${ad.sellerId}`,
                                          ButtonStyle.Primary,
                                      ),
                                  ]
                                : []),
                        ],
                    },
                ],
            },
        ],
    };
}

export function buildAdminLog(title, lines) {
    return message([text(`## ${title}\n${lines.join('\n')}`)]);
}

function message(components) {
    return suppressMentions({
        flags: MessageFlags.IsComponentsV2,
        components: [{ type: ComponentType.Container, components }],
    });
}

function text(content) {
    return { type: ComponentType.TextDisplay, content };
}

function section(content, customId, label) {
    return {
        type: ComponentType.Section,
        components: [text(content)],
        accessory: button(label, customId),
    };
}

function button(label, customId, style = ButtonStyle.Secondary) {
    return { type: ComponentType.Button, customId, label, style };
}

function separator() {
    return { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small };
}
