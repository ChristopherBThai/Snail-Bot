import { GatewayDispatchEvents, InteractionType } from 'discord-api-types/v10';
import { LogLevels } from '../logger/index.js';
import { getCommandKey } from './commands.js';
import { ephemeralText } from './components.js';

export function createDiscordEventRouter({ commands, components = [], config, logger, modals = [], modules, rest }) {
    const commandMap = collectCommandRoutes(commands);
    const cooldowns = new Map();
    let botUserID;
    const componentRoutes = collectCustomIDRoutes({
        commands,
        globalRoutes: components,
        moduleRoutes: modules.components,
        routeType: 'components',
        surface: 'component'
    });
    const modalRoutes = collectCustomIDRoutes({
        commands,
        globalRoutes: modals,
        moduleRoutes: modules.modals,
        routeType: 'modals',
        surface: 'modal'
    });

    return {
        async route(payload) {
            if (payload.t === GatewayDispatchEvents.Ready) {
                botUserID = payload.d.user.id;
                const timer = logger.time('discord.ready.dispatched', { botUserID });

                await modules.dispatch('ready', { ...rest, botUserID });
                timer.end({ moduleCount: modules.sorted.length }, { level: LogLevels.Info });
                return;
            }

            if (payload.t === GatewayDispatchEvents.MessageCreate) {
                const timer = logger.time('discord.message_create.dispatched', getMessageLogData(payload.d));

                await modules.dispatch('message', payload.d, { ...rest, botUserID });
                timer.end({}, { level: LogLevels.Trace });
                return;
            }

            if (payload.t === GatewayDispatchEvents.MessageDelete) {
                const timer = logger.time('discord.message_delete.dispatched', getMessageLogData(payload.d));

                await modules.dispatch('message_delete', payload.d, { ...rest, botUserID });
                timer.end({}, { level: LogLevels.Trace });
                return;
            }

            if (payload.t !== GatewayDispatchEvents.InteractionCreate) {
                logger.trace('discord.gateway_event.ignored', { eventType: payload.t });
                return;
            }

            const interaction = payload.d;
            const route = getRoute({ commandMap, componentRoutes, interaction, modalRoutes });
            const log = logger.child(getInteractionLogData(interaction));

            if (!route) {
                log.trace('discord.interaction.unrouted', { interactionType: interaction.type });
                return;
            }

            const routeData = getRouteLogData(route, interaction);
            const timer = log.time('discord.interaction.handled', routeData);
            const context = createInteractionContext({ config, interaction, logger, modules, rest, route });

            try {
                if (route.auth && !(await route.auth(context))) {
                    log.warn('discord.interaction.rejected', { ...routeData, reason: 'auth_failed' });
                    if (route.autocomplete) {
                        await context.autocomplete([]);
                        timer.end({ rejected: true }, { level: LogLevels.Debug });
                        return;
                    }

                    await context.respond(ephemeralText('You cannot use that interaction.'));
                    timer.end({ rejected: true }, { level: LogLevels.Debug });
                    return;
                }

                if (route.module && !route.module.active && !route.allowDisabled) {
                    log.warn('discord.interaction.rejected', {
                        ...routeData,
                        moduleID: route.module.id,
                        reason: 'module_disabled'
                    });
                    await context.respond(ephemeralText(route.module.inactiveMessage()));
                    timer.end({ rejected: true }, { level: LogLevels.Debug });
                    return;
                }

                const cooldown = getActiveCooldown(route, context, cooldowns);
                if (cooldown) {
                    log.debug('discord.interaction.rejected', {
                        ...routeData,
                        availableAt: cooldown.availableAt,
                        reason: 'cooldown'
                    });
                    await context.respond(ephemeralText(`Try that again ${formatCooldown(cooldown.availableAt)}.`));
                    timer.end({ rejected: true }, { level: LogLevels.Debug });
                    return;
                }

                await route.handle(context, route);
                timer.end({ deferred: context.deferred }, { level: LogLevels.Debug });
            } catch (error) {
                console.error(error);
                timer.fail(error, routeData);
                logger.error('discord.interaction.handler_error', {
                    commandName: context.commandName,
                    customID: context.customID,
                    error
                });
                route.module?.logger.error('interaction.error', {
                    commandName: context.commandName,
                    customID: context.customID,
                    error
                });
                const sendError = context.deferred ? context.editReply : context.respond;
                await Promise.resolve(
                    sendError(ephemeralText('Something went wrong while handling that interaction.'))
                ).catch(() => {});
            }
        }
    };
}

function getMessageLogData(message) {
    return {
        authorID: message.author?.id,
        bot: message.author?.bot,
        channelID: message.channel_id ?? message.channelId,
        messageID: message.id
    };
}

function getInteractionLogData(interaction) {
    return {
        channelID: interaction.channel_id,
        guildID: interaction.guild_id,
        interactionID: interaction.id,
        userID: interaction.member?.user?.id ?? interaction.user?.id
    };
}

function getRouteLogData(route, interaction) {
    return {
        commandName: interaction.data?.name,
        customID: interaction.data?.custom_id ?? interaction.data?.customId,
        interactionType: interaction.type,
        moduleID: route.module?.id,
        routeType: getInteractionRouteType(route, interaction)
    };
}

function getInteractionRouteType(route, interaction) {
    if (route.autocomplete) {
        return 'autocomplete';
    }

    switch (interaction.type) {
        case InteractionType.ApplicationCommand:
            return 'command';
        case InteractionType.MessageComponent:
            return 'component';
        case InteractionType.ModalSubmit:
            return 'modal';
        default:
            return 'unknown';
    }
}

function getActiveCooldown(route, context, cooldowns) {
    if (!route.cooldown || route.autocomplete) {
        return undefined;
    }

    const userID = context.userID;
    if (!userID) {
        return undefined;
    }

    const key = `${context.commandName}:${userID}`;
    const now = Date.now();
    const availableAt = cooldowns.get(key) ?? 0;
    if (availableAt > now) {
        return { availableAt };
    }

    cooldowns.set(key, now + route.cooldown);
    return undefined;
}

function formatCooldown(availableAt) {
    return `<t:${Math.ceil(availableAt / 1000)}:R>`;
}

function createInteractionContext({ config, interaction, logger, modules, rest, route }) {
    const data = interaction.data ?? {};
    const customID = data.custom_id ?? data.customId;
    const resolvedMessages = normalizeResolvedCollection(data.resolved?.messages);
    const resolvedRoles = normalizeResolvedCollection(data.resolved?.roles);
    let deferred = false;

    return {
        config,
        data,
        interaction,
        logger,
        modules,
        module: route.module,
        applicationID: config.discord.applicationId,
        commandName: data.name,
        customID,
        channelID: interaction.channel_id,
        guildID: interaction.guild_id,
        memberRoles: interaction.member?.roles ?? [],
        modalValues: extractModalValues(data.components ?? []),
        resolvedAttachments: normalizeResolvedCollection(data.resolved?.attachments),
        resolvedMessages,
        resolvedRoles,
        target: getTarget(data, resolvedMessages),
        targetID: data.target_id ?? data.targetId,
        userID: interaction.member?.user?.id ?? interaction.user?.id,
        get deferred() {
            return deferred;
        },
        async defer(options) {
            await rest.defer(interaction, options);
            deferred = true;
        },
        async deferUpdate() {
            await rest.deferUpdate(interaction);
            deferred = true;
        },
        edit(message) {
            return rest.edit(interaction, message);
        },
        autocomplete(choices) {
            return rest.autocomplete(interaction, choices);
        },
        editReply(message) {
            return rest.editReply(interaction, message);
        },
        followUp(message) {
            return rest.followUp(interaction, message);
        },
        openModal(modal) {
            return rest.openModal(interaction, modal);
        },
        respond(message) {
            return rest.respond(interaction, message);
        },
        sendMessage(channelID, message) {
            return rest.sendMessage(channelID, message);
        },
        editMessage(channelID, messageID, message) {
            return rest.editMessage(channelID, messageID, message);
        },
        getMessage(channelID, messageID) {
            return rest.getMessage(channelID, messageID);
        },
        deleteMessage(channelID, messageID) {
            return rest.deleteMessage(channelID, messageID);
        },
        addGuildMemberRole(guildID, userID, roleID) {
            return rest.addGuildMemberRole(guildID, userID, roleID);
        },
        setChannelRoleOverwrite(channelID, roleID, overwrite) {
            return rest.setChannelRoleOverwrite(channelID, roleID, overwrite);
        },
        editBotNickname(guildID, nickname) {
            return rest.editBotNickname(guildID, nickname);
        }
    };
}

function getTarget(data, messages) {
    const targetID = data.target_id ?? data.targetId;

    return targetID ? messages[targetID] : undefined;
}

function normalizeResolvedCollection(collection) {
    if (!collection) {
        return {};
    }

    if (Array.isArray(collection)) {
        return Object.fromEntries(collection.map((item) => [item.id, item]));
    }

    return collection;
}

function getRoute({ commandMap, componentRoutes, interaction, modalRoutes }) {
    const data = interaction.data ?? {};

    if (interaction.type === InteractionType.ApplicationCommand) {
        return commandMap.get(getCommandKey(data));
    }

    if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
        const command = commandMap.get(getCommandKey(data));
        if (!command?.autocomplete) {
            return undefined;
        }

        return {
            auth: command.auth,
            autocomplete: true,
            module: command.module,
            handle: async (context) => {
                await context.autocomplete(await command.autocomplete(context));
            }
        };
    }

    if (interaction.type === InteractionType.MessageComponent) {
        const customID = data.custom_id ?? data.customId;
        return getCustomIDRoute(componentRoutes, customID);
    }

    if (interaction.type === InteractionType.ModalSubmit) {
        const customID = data.custom_id ?? data.customId;
        return getCustomIDRoute(modalRoutes, customID);
    }

    return undefined;
}

function collectCommandRoutes(commands) {
    const routes = new Map();

    for (const command of commands) {
        const key = getCommandKey(command.definition);
        if (routes.has(key)) {
            throw new Error(`Duplicate command route: ${key}`);
        }

        routes.set(key, command);
    }

    return routes;
}

function collectCustomIDRoutes({ commands, globalRoutes, moduleRoutes, routeType, surface }) {
    const exact = new Map();
    const prefixes = [];

    addCustomIDRoutes(exact, prefixes, globalRoutes ?? [], surface);
    addCustomIDRoutes(exact, prefixes, moduleRoutes ?? [], surface);

    for (const command of commands) {
        addCustomIDRoutes(exact, prefixes, command[routeType] ?? [], surface);
    }

    return { exact, prefixes };
}

function addCustomIDRoutes(exact, prefixes, routes, surface) {
    if (routes instanceof Map) {
        for (const [customID, route] of routes) {
            if (exact.has(customID)) {
                throw new Error(`Duplicate ${surface} route: ${customID}`);
            }

            exact.set(customID, route);
        }

        return;
    }

    for (const route of routes) {
        if (route.customID) {
            if (exact.has(route.customID)) {
                throw new Error(`Duplicate ${surface} route: ${route.customID}`);
            }

            exact.set(route.customID, route);
            continue;
        }

        if (route.prefix) {
            if (prefixes.some((existing) => existing.prefix === route.prefix)) {
                throw new Error(`Duplicate ${surface} route prefix: ${route.prefix}`);
            }

            prefixes.push(route);
        }
    }
}

function getCustomIDRoute(routes, customID) {
    if (typeof customID !== 'string') {
        return undefined;
    }

    return routes.exact.get(customID) ?? routes.prefixes.find((route) => customID.startsWith(route.prefix));
}

export function extractModalValues(components) {
    const values = {};

    for (const component of components) {
        addModalValues(component, values);
    }

    return values;
}

function addModalValues(component, values) {
    if (!component || typeof component !== 'object') {
        return;
    }

    const customID = component.custom_id ?? component.customId;
    if (typeof customID === 'string') {
        if (typeof component.value === 'string' || typeof component.value === 'boolean') {
            values[customID] = component.value;
        }

        if (typeof component.checked === 'boolean') {
            values[customID] = component.checked;
        }

        if (Array.isArray(component.values) && component.values.every((value) => typeof value === 'string')) {
            values[customID] = component.values;
        }
    }

    if (Array.isArray(component.components)) {
        for (const child of component.components) {
            addModalValues(child, values);
        }
    }

    addModalValues(component.component, values);
}
