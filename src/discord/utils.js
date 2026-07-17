export function getCommandOptionValue(context, optionName) {
    const option = context.data.options?.find((candidate) => candidate.name === optionName);

    return String(option?.value ?? '');
}

export function getSubcommand(context) {
    return context.data.options?.[0];
}

export function getSubcommandOption(context, optionName) {
    return getSubcommand(context)?.options?.find((candidate) => candidate.name === optionName);
}

export function getSubcommandOptionValue(context, optionName) {
    const option = getSubcommandOption(context, optionName);

    return option?.value === undefined ? '' : String(option.value);
}

export function getFocusedSubcommandOption(context) {
    return getSubcommand(context)?.options?.find((option) => option.focused);
}

export function getMessageJumpLink({ channelId, guildId, messageId }) {
    return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export function getModalValues(components) {
    const values = {};
    const pending = [...components];

    while (pending.length) {
        const component = pending.pop();

        if (component.custom_id && Object.hasOwn(component, 'value')) {
            values[component.custom_id] = component.value;
        }

        if (component.custom_id && Object.hasOwn(component, 'values')) {
            values[component.custom_id] = component.values;
        }

        pending.push(...(component.components ?? []));

        if (component.component) {
            pending.push(component.component);
        }
    }

    return values;
}
