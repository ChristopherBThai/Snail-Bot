import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ComponentType,
    GatewayDispatchEvents,
} from 'discord-api-types/v10';
import { getInteractionUser } from '../../discord/interactions.js';
import { createSupporterRoleSynchronization } from './synchronization.js';

const ROLE_NAMES = Object.freeze([
    'base',
    'ticketCommon',
    'discordUncommon',
    'patreonCommon',
    'patreonUncommon',
    'legendary',
    'fabled',
]);

const ROLES_COMMAND_DEFINITION = {
    type: ApplicationCommandType.ChatInput,
    name: 'roles',
    description: 'Synchronize your supporter perk roles.',
    options: [
        {
            type: ApplicationCommandOptionType.Boolean,
            name: 'optout',
            description: 'Whether Snail should stop managing your optional supporter roles.',
            required: false,
        },
    ],
};

/** @type {import('../../packages.js').PackageSetup} */
export default async function setup({ config, logging, rest, services }) {
    const log = logging.createLogger('supporterRoles');
    const roleIds = config.roles?.supporters ?? {};
    const mongo = services.snail.mongo;
    const mysql = services.owo.mysql;
    const missing = [
        ...ROLE_NAMES.map((name) => !roleIds[name] && `roles.supporters.${name} (config)`),
        !mongo && 'Snail Mongo',
        !mysql && 'OwO MySQL',
    ].filter(Boolean);
    const synchronization = missing.length
        ? undefined
        : createSupporterRoleSynchronization({
              guildId: config.guildId,
              roleIds,
              User: mongo.User,
              mysql,
              rest,
              log,
          });
    await synchronization?.initialize();

    return {
        name: 'Supporter Roles',
        missing,
        commands: [{ definition: ROLES_COMMAND_DEFINITION, handle: synchronizeRoleManagement }],
        feature: {
            id: 'supporterRoles',
            description: 'Synchronizes Discord roles with active OwO supporter perks.',
            toggleable: true,
            activate: synchronization?.activate,
            deactivate: synchronization?.deactivate,
            events: synchronization
                ? [
                      { event: GatewayDispatchEvents.GuildMemberAdd, handle: synchronization.memberAdded },
                      { event: GatewayDispatchEvents.GuildMemberUpdate, handle: synchronization.memberUpdated },
                      { event: GatewayDispatchEvents.MessageCreate, handle: synchronization.messageCreated },
                  ]
                : [],
            settings: {
                pages: [{ id: 'overview', label: 'Overview', render: renderOverview }],
            },
        },
    };

    function renderOverview() {
        const status = synchronization.getStatus();
        return [
            {
                type: ComponentType.TextDisplay,
                content:
                    '### Runtime\n' +
                    `**Cached Users:** ${status.cachedUsers.toLocaleString()}\n` +
                    `**Pending Users:** ${status.pendingUsers.toLocaleString()}\n` +
                    `**Pending Role Updates:** ${status.pendingRoleUpdates.toLocaleString()}\n` +
                    `**Processing Users:** ${status.processingUsers.toLocaleString()}\n` +
                    `**Opted Out Users:** ${status.optedOutUsers.toLocaleString()}\n` +
                    `**MySQL Status:** ${status.mysql}\n` +
                    `**Role Status:** ${status.roles}`,
            },
        ];
    }

    async function synchronizeRoleManagement({ interaction, defer, respond }) {
        await defer({ ephemeral: true });
        const optout = interaction.data.options?.find((option) => option.name === 'optout')?.value;
        const userId = getInteractionUser(interaction).id;
        const changedManagement = typeof optout === 'boolean';
        if (changedManagement) await synchronization.setOptout(userId, optout);

        let result;
        try {
            result = await synchronization.synchronizeUser({ userId, roles: interaction.member.roles });
        } catch (error) {
            if (!changedManagement) throw error;
            log.error('Could not synchronize supporter roles after changing role management', {
                error,
                userId,
                optout,
            });
            await respond(
                'Your supporter role management setting was saved, but your roles could not be synchronized. Run `/roles` again to retry.',
                { ephemeral: true },
            );
            return;
        }

        let message = 'Your supporter roles have been synchronized.';
        if (optout === true) {
            message =
                'You are now opted out of optional supporter roles. Roles covered by this preference have been removed.';
        } else if (optout === false) {
            message = 'You are now opted in to optional supporter roles. Your supporter roles have been synchronized.';
        } else if (result.optedOut) {
            message =
                'You are currently opted out of optional supporter roles. Only roles unaffected by this preference were synchronized.';
        }

        await respond(message, { ephemeral: true });
    }
}
