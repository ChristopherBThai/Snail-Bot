import { getInteractionUser } from '../../discord/interactions.js';
import { getMissingSettings } from './settings.js';

export function createTicketMarketAccess({ config, settings, log, rest, sendAdminLog }) {
    return {
        acceptMarketRules,
        acceptSellerRules,
        getUnavailableMessage,
    };

    async function acceptMarketRules(context) {
        const unavailableMessage = getUnavailableMessage(context);
        if (unavailableMessage) return context.respond(unavailableMessage, { ephemeral: true });
        if (context.interaction.member.roles.includes(settings.marketAccessRole)) {
            return context.respond('You already have Ticket Market access.', { ephemeral: true });
        }

        const userId = getInteractionUser(context.interaction).id;
        const timer = log.time();
        await context.defer({ ephemeral: true });
        await rest.addRole(config.guildId, userId, settings.marketAccessRole, 'Accepted Ticket Market rules');
        timer.checkpoint('discord');
        await context.editResponse('Ticket Market access granted.');
        timer.checkpoint('response');
        timer.info('Accepted Ticket Market rules', { userId, roleId: settings.marketAccessRole });
        await sendAdminLog('Market Rules Accepted', [`**User:** <@${userId}> (\`${userId}\`)`]);
    }

    async function acceptSellerRules(context) {
        const unavailableMessage = getUnavailableMessage(context);
        if (unavailableMessage) return context.respond(unavailableMessage, { ephemeral: true });
        if (!context.interaction.member.roles.includes(settings.marketAccessRole)) {
            return context.respond('Accept the market rules before accepting the seller rules.', { ephemeral: true });
        }
        if (context.interaction.member.roles.includes(settings.sellerAccessRole)) {
            return context.respond('You already have Ticket Market seller access.', { ephemeral: true });
        }

        const userId = getInteractionUser(context.interaction).id;
        const timer = log.time();
        await context.defer({ ephemeral: true });
        await rest.addRole(config.guildId, userId, settings.sellerAccessRole, 'Accepted Ticket Market seller rules');
        timer.checkpoint('discord');
        await context.editResponse('Ticket Market seller access granted.');
        timer.checkpoint('response');
        timer.info('Accepted Ticket Market seller rules', { userId, roleId: settings.sellerAccessRole });
        await sendAdminLog('Seller Rules Accepted', [`**User:** <@${userId}> (\`${userId}\`)`]);
    }

    function getUnavailableMessage(context) {
        const missing = getMissingSettings(settings);
        if (missing.length) {
            log.trace('Denied Ticket Market access for incomplete configuration', {
                userId: getInteractionUser(context.interaction).id,
                missing,
            });
            return 'Ticket Market is not configured.';
        }
        if (context.interaction.member.roles.includes(settings.marketWarnedRole)) {
            log.debug('Denied Ticket Market access to warned user', {
                userId: getInteractionUser(context.interaction).id,
            });
            return 'Ticket Market access is not available for your account.';
        }
    }
}
