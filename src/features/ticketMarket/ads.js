import { ComponentType, TextInputStyle } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { getCustomIdSuffix, getInteractionUser, getModalValue } from '../../discord/interactions.js';
import { DELETE_AD_PREFIX, STILL_SELLING_PREFIX } from './render.js';

const MAX_NOTE_LENGTH = 140;
const STOCK_INPUT_ID = 'ticketMarket:stock';
const PRICE_INPUT_ID = 'ticketMarket:price';
const NOTE_INPUT_ID = 'ticketMarket:note';
const COLOR_INPUT_ID = 'ticketMarket:color';
const DELETE_REASON_INPUT_ID = 'ticketMarket:deleteReason';

export const POST_AD_MODAL_ID = 'ticketMarket:postAdModal';
export const DELETE_AD_MODAL_PREFIX = 'ticketMarket:deleteAdModal:';

export function createTicketMarketAds({ config, getAccessUnavailable, getSettings, log, runtime }) {
    return {
        openPostAdModal,
        postAd,
        openDeleteAd,
        deleteAdFromModal,
        stillSelling,
    };

    async function openPostAdModal(context) {
        const settings = await getSettings();
        const unavailable = await getSellerUnavailableMessage(context, settings);
        if (unavailable) {
            log.trace('Rejected Ticket Market ad modal', {
                userId: getInteractionUser(context.interaction).id,
                reason: unavailable,
            });
            return context.respond(unavailable, { ephemeral: true });
        }
        await context.openModal(buildPostAdModal(settings));
    }

    async function postAd(context) {
        const settings = await getSettings();
        const unavailable = await getSellerUnavailableMessage(context, settings);
        if (unavailable) return context.respond(unavailable, { ephemeral: true });

        const draft = readAdDraft(context.interaction, settings.maxPrice);
        if (!draft.ok) {
            log.trace('Rejected Ticket Market ad draft', {
                userId: getInteractionUser(context.interaction).id,
                reason: draft.message,
            });
            return context.respond(draft.message, { ephemeral: true });
        }

        await context.defer({ ephemeral: true });
        const message = await runtime.postAd(getInteractionUser(context.interaction).id, draft.value, settings);
        await context.editResponse(message);
    }

    async function openDeleteAd(context) {
        const sellerId = getCustomIdSuffix(context.interaction, DELETE_AD_PREFIX);
        const ad = runtime.getActiveAd(sellerId);
        if (!matchesAdInteraction(context, ad)) {
            log.trace('Rejected deletion from inactive Ticket Market ad', {
                sellerId,
                messageId: context.interaction.message?.id,
            });
            return context.respond('That Ticket Market ad is no longer active.', { ephemeral: true });
        }

        const userId = getInteractionUser(context.interaction).id;
        if (userId === sellerId) {
            await context.deferUpdate();
            await runtime.deleteAd(ad, {
                actorId: userId,
                reason: 'Seller deleted their ad.',
                source: 'seller',
            });
            await context.respond('Ticket Market ad deleted.', { ephemeral: true });
            return;
        }
        if (!hasManagerAccess(context.interaction, config)) {
            log.debug('Denied Ticket Market ad deletion', { sellerId, userId });
            return context.respond('You do not have permission to delete that ad.', { ephemeral: true });
        }
        await context.openModal(buildDeleteAdModal(sellerId));
    }

    async function deleteAdFromModal(context) {
        if (!hasManagerAccess(context.interaction, config)) {
            return context.respond('You do not have permission to delete that ad.', { ephemeral: true });
        }
        const sellerId = getCustomIdSuffix(context.interaction, DELETE_AD_MODAL_PREFIX);
        const ad = runtime.getActiveAd(sellerId);
        if (!matchesAdInteraction(context, ad)) {
            return context.respond('That Ticket Market ad is no longer active.', { ephemeral: true });
        }
        const actorId = getInteractionUser(context.interaction).id;
        const reason =
            String(getModalValue(context.interaction, DELETE_REASON_INPUT_ID) ?? '').trim() || 'No reason provided.';
        await context.deferUpdate();
        await runtime.deleteAd(ad, { actorId, reason, source: 'moderator' });
        await context.respond('Ticket Market ad deleted.', { ephemeral: true });
    }

    async function stillSelling(context) {
        const sellerId = getCustomIdSuffix(context.interaction, STILL_SELLING_PREFIX);
        if (sellerId !== getInteractionUser(context.interaction).id) {
            return context.respond('Only the seller can refresh this ad.', { ephemeral: true });
        }
        if (!(await getSettings()).availabilityTimeout) {
            return context.respond('That Still Selling button is no longer available.', { ephemeral: true });
        }
        await context.deferUpdate();
        const refreshed = await runtime.refreshAvailability(sellerId, context.interaction.message?.id, 'button');
        if (!refreshed) {
            return context.respond('That Still Selling button is no longer available.', { ephemeral: true });
        }
        await context.respond('Availability refreshed.', { ephemeral: true });
    }

    async function getSellerUnavailableMessage(context, settings) {
        const accessMessage = getAccessUnavailable(context, settings);
        if (accessMessage) return accessMessage;
        const roles = context.interaction.member.roles;
        if (!roles.includes(settings.marketAccessRole) || !roles.includes(settings.sellerAccessRole)) {
            return 'Accept the market and seller rules before posting a Ticket Market ad.';
        }
        const userId = getInteractionUser(context.interaction).id;
        if (runtime.getActiveAd(userId)) return 'You already have an active Ticket Market ad.';
    }
}

function matchesAdInteraction(context, ad) {
    return ad !== undefined && ad.messageId === context.interaction.message?.id;
}

function buildPostAdModal(settings) {
    return {
        title: 'Post Ticket Market Ad',
        customId: POST_AD_MODAL_ID,
        components: [
            input('Price per ticket', PRICE_INPUT_ID, { placeholder: String(settings.maxPrice) }),
            input('Wrapped Ticket stock', STOCK_INPUT_ID, { placeholder: '1' }),
            input('Note', NOTE_INPUT_ID, { required: false, maxLength: MAX_NOTE_LENGTH, placeholder: 'Optional' }),
            input('Accent color', COLOR_INPUT_ID, { required: false, placeholder: '#5865F2' }),
        ],
    };
}

function buildDeleteAdModal(sellerId) {
    return {
        title: 'Delete Ticket Market Ad',
        customId: `${DELETE_AD_MODAL_PREFIX}${sellerId}`,
        components: [
            input('Reason', DELETE_REASON_INPUT_ID, {
                required: false,
                maxLength: MAX_NOTE_LENGTH,
                placeholder: 'Optional',
            }),
        ],
    };
}

function readAdDraft(interaction, maxPrice) {
    const stockValue = String(getModalValue(interaction, STOCK_INPUT_ID) ?? '').trim();
    const priceValue = String(getModalValue(interaction, PRICE_INPUT_ID) ?? '').trim();
    const ticketCount = /^\d+$/.test(stockValue) ? Number(stockValue) : Number.NaN;
    const price = /^\d+$/.test(priceValue) ? Number(priceValue) : Number.NaN;
    const note = String(getModalValue(interaction, NOTE_INPUT_ID) ?? '').trim();
    const color = String(getModalValue(interaction, COLOR_INPUT_ID) ?? '').trim();
    if (!Number.isSafeInteger(ticketCount) || ticketCount <= 0) {
        return { ok: false, message: 'Enter a positive whole number of Wrapped Tickets.' };
    }
    if (!Number.isSafeInteger(price) || price <= 0) {
        return { ok: false, message: 'Enter a positive whole-number price per ticket.' };
    }
    if (price > maxPrice) {
        return { ok: false, message: `Ticket ads cannot charge more than ${maxPrice.toLocaleString()} per ticket.` };
    }
    if (note.length > MAX_NOTE_LENGTH) {
        return { ok: false, message: `Notes cannot exceed ${MAX_NOTE_LENGTH} characters.` };
    }

    let accentColor;
    if (color) {
        if (!/^#?[\da-f]{6}$/i.test(color)) return { ok: false, message: 'Enter a six-digit hexadecimal color.' };
        accentColor = Number.parseInt(color.replace('#', ''), 16);
    }
    return {
        ok: true,
        value: {
            ticketCount,
            price,
            ...(note ? { note } : {}),
            ...(accentColor === undefined ? {} : { accentColor }),
        },
    };
}

function input(label, customId, { required = true, maxLength, placeholder } = {}) {
    return {
        type: ComponentType.Label,
        label,
        component: {
            type: ComponentType.TextInput,
            customId,
            style: TextInputStyle.Short,
            required,
            ...(maxLength ? { maxLength } : {}),
            ...(placeholder ? { placeholder } : {}),
        },
    };
}
