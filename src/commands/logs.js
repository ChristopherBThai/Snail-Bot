import {
    ApplicationCommandType,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    SeparatorSpacingSize,
} from 'discord-api-types/v10';
import { hasManagerAccess } from '../discord/auth.js';
import { getSelectValue } from '../discord/interactions.js';
import { suppressMentions } from '../discord/messages.js';
import { serializeLoggerLogs, serializeLogs } from '../logging/export.js';
import { LOG_LEVELS } from '../logging/index.js';
import { saveLoggingLevel } from '../logging/repository.js';
import { getTimestampForFilename } from '../utils/files.js';

const SOURCE_SELECT_ID = 'logs:source';
const EXPORT_ALL_ID = 'logs:exportAll';
const EXPORT_PREFIX = 'logs:export:';
const LEVEL_PREFIX = 'logs:level:';

const LOGS_COMMAND_DEFINITION = {
    type: ApplicationCommandType.ChatInput,
    name: 'logs',
    description: 'Open runtime log controls.',
};

/** @type {import('../packages.js').PackageSetup} */
export default function setup({ logging, services, unavailable }) {
    const log = logging.createLogger('logs');
    const Setting = services.snail.mongo?.Setting;

    return {
        name: 'Logs Command',
        missing: unavailable.snail.mongo ?? [],
        commands: [
            {
                definition: LOGS_COMMAND_DEFINITION,
                staff: true,
                authorize: hasManagerAccess,
                async handle(context) {
                    await context.respond(buildPanel(logging), { ephemeral: true });
                },
            },
        ],
        components: [
            interaction(SOURCE_SELECT_ID, selectSource),
            interaction(EXPORT_ALL_ID, exportAll),
            interaction(EXPORT_PREFIX, exportSource, true),
            interaction(LEVEL_PREFIX, setLevel, true),
        ],
    };

    function interaction(id, handle, prefix = false) {
        return {
            [prefix ? 'prefix' : 'id']: id,
            authorize: hasManagerAccess,
            handle,
        };
    }

    async function selectSource(context) {
        const logger = getLogger(logging, getSelectValue(context.interaction));
        if (!logger) {
            await context.respond('Choose a valid logger.', { ephemeral: true });
            return;
        }

        await context.update(buildPanel(logging, logger.name));
    }

    async function setLevel(context) {
        const logger = getLogger(logging, getCustomIdValue(context.interaction, LEVEL_PREFIX));
        const level = getSelectValue(context.interaction);

        if (!logger) {
            await context.respond('Choose a valid logger.', { ephemeral: true });
            return;
        }

        if (!LOG_LEVELS.includes(level)) {
            await context.respond('Choose a valid log level.', { ephemeral: true });
            return;
        }

        await saveLoggingLevel(Setting, logger.name, level);
        log.info('Changed log level', { logger: logger.name, from: logger.level, to: level });
        logging.setLevel(logger.name, level);
        await context.update(buildPanel(logging, logger.name));
    }

    async function exportSource(context) {
        const logger = getLogger(logging, getCustomIdValue(context.interaction, EXPORT_PREFIX));
        if (!logger) {
            await context.respond('Choose a valid logger.', { ephemeral: true });
            return;
        }

        await exportLogs(context, `${logger.name}-logs`, serializeLoggerLogs(logger));
    }

    async function exportAll(context) {
        await exportLogs(context, 'all-logs', serializeLogs(logging.getLoggers()));
    }
}

function buildPanel(logging, selectedName) {
    const loggers = logging.getLoggers().toSorted((a, b) => a.name.localeCompare(b.name));
    const selected = loggers.find((logger) => logger.name === selectedName);
    const logCount = loggers.reduce((total, logger) => total + logger.size, 0);

    return suppressMentions({
        flags: MessageFlags.IsComponentsV2,
        components: [
            {
                type: ComponentType.Container,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content:
                            `## Runtime Logs\n` +
                            `-# ${loggers.length.toLocaleString()} loggers · ${logCount.toLocaleString()} logs`,
                    },
                    separator(true),
                    {
                        type: ComponentType.TextDisplay,
                        content: selected
                            ? `-# Logger · ${selected.size.toLocaleString()}/${selected.limit.toLocaleString()} logs`
                            : '-# Logger',
                    },
                    {
                        type: ComponentType.ActionRow,
                        components: [
                            {
                                type: ComponentType.StringSelect,
                                customId: SOURCE_SELECT_ID,
                                placeholder: 'Choose a logger',
                                options: loggers.map((logger) => ({
                                    label: logger.name,
                                    value: logger.name,
                                    description: `${logger.size.toLocaleString()} logs at ${logger.level}`,
                                    default: logger === selected,
                                })),
                            },
                        ],
                    },
                    ...(selected ? selectedControls(selected) : []),
                    separator(true),
                    {
                        type: ComponentType.ActionRow,
                        components: [
                            ...(selected
                                ? [
                                      {
                                          type: ComponentType.Button,
                                          customId: `${EXPORT_PREFIX}${selected.name}`,
                                          label: 'Export Logger',
                                          style: ButtonStyle.Secondary,
                                      },
                                  ]
                                : []),
                            {
                                type: ComponentType.Button,
                                customId: EXPORT_ALL_ID,
                                label: 'Export All Logs',
                                style: ButtonStyle.Secondary,
                            },
                        ],
                    },
                ],
            },
        ],
    });
}

function selectedControls(logger) {
    return [
        {
            type: ComponentType.TextDisplay,
            content: '-# Minimum log level',
        },
        {
            type: ComponentType.ActionRow,
            components: [
                {
                    type: ComponentType.StringSelect,
                    customId: `${LEVEL_PREFIX}${logger.name}`,
                    placeholder: 'Choose minimum level',
                    options: LOG_LEVELS.map((level) => ({
                        label: level,
                        value: level,
                        description: `Keep ${level} and higher logs.`,
                        default: logger.level === level,
                    })),
                },
            ],
        },
    ];
}

function separator(divider) {
    return {
        type: ComponentType.Separator,
        divider,
        spacing: SeparatorSpacingSize.Small,
    };
}

function getLogger(logging, name) {
    return logging.getLoggers().find((logger) => logger.name === name);
}

function getCustomIdValue(interaction, prefix) {
    return interaction.data.customId.slice(prefix.length);
}

async function exportLogs(context, prefix, data) {
    const bytes = Buffer.byteLength(data);

    if (bytes > context.interaction.attachmentSizeLimit) {
        await context.respond('The requested logs are too large to send through Discord.', { ephemeral: true });
        return;
    }

    await context.respond({
        flags: MessageFlags.Ephemeral,
        files: [
            {
                name: `${prefix}-${getTimestampForFilename()}.json`,
                blob: new Blob([data], { type: 'application/json' }),
            },
        ],
    });
}
