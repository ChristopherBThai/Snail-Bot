import {
    accentContainer,
    actionButton,
    actionRow,
    componentsMessage,
    ephemeralText,
    MessageFlags,
    section,
    separator,
    stringSelect,
    textDisplay
} from '../systems/discord/components.js';
import { saveLogLevel } from '../systems/logger/data.js';
import { LogLevels, LogLevelWeights } from '../systems/logger/index.js';
import { auth, getColor, getTimestampForFilename, jsonFile, lines } from '../utils.js';

export const LogsPanelIDs = Object.freeze({
    ExportAll: 'logs_panel:export_all',
    ExportSourcePrefix: 'logs_panel:export:',
    LevelPrefix: 'logs_panel:level:',
    SourceSelect: 'logs_panel:source'
});

export default function logsCommand({ databases, logging }) {
    return {
        auth: auth.manager,
        staff: true,
        definition: {
            name: 'logs',
            description: 'Open runtime log controls.'
        },
        components: [
            {
                customID: LogsPanelIDs.SourceSelect,
                auth: auth.manager,
                handle: selectSource
            },
            {
                customID: LogsPanelIDs.ExportAll,
                auth: auth.manager,
                handle: exportAllLogs
            },
            {
                prefix: LogsPanelIDs.ExportSourcePrefix,
                auth: auth.manager,
                handle: exportSourceLogs
            },
            {
                prefix: LogsPanelIDs.LevelPrefix,
                auth: auth.manager,
                handle: setSourceLevel
            }
        ],
        async handle(context) {
            await context.respond(buildLogsPanel(context, logging));
        }
    };

    async function selectSource(context) {
        await context.edit(buildLogsPanel(context, logging, context.data.values[0]));
    }

    async function setSourceLevel(context, route) {
        const sourceID = getCustomIDValue(context, route);
        const level = context.data.values?.[0];

        if (!getLogSource(context, logging, sourceID)) {
            await context.respond(ephemeralText('Choose a valid log source.'));
            return;
        }

        if (LogLevelWeights[level] === undefined) {
            await context.respond(ephemeralText('Choose a valid log level.'));
            return;
        }

        logging.setLevel(sourceID, level);
        await saveLogLevel(databases, sourceID, level);

        await context.edit(buildLogsPanel(context, logging, sourceID));
    }

    async function exportSourceLogs(context, route) {
        const sourceID = getCustomIDValue(context, route);
        if (!getLogSource(context, logging, sourceID)) {
            await context.respond(ephemeralText('Choose a valid log source.'));
            return;
        }

        await context.respond(buildJsonFileMessage(`${sourceID}-logs`, logging.getEntries({ sourceID })));
    }

    async function exportAllLogs(context) {
        await context.respond(buildJsonFileMessage('all-logs', logging.getEntries()));
    }
}

export function buildLogsPanel(context, logging, selectedSourceID) {
    const sources = getLogSources(context, logging);
    const selectedSource = sources.find((source) => source.sourceID === selectedSourceID);

    return componentsMessage(
        accentContainer(
            getColor(context, 'primary'),
            textDisplay('## Logs'),
            separator(),
            ...buildSourceSections(sources),
            separator(),
            ...buildSelectedSourceControls(sources, selectedSource),
            separator(),
            actionRow(actionButton('Export All Logs', LogsPanelIDs.ExportAll))
        )
    );
}

function buildSourceSections(sources) {
    if (!sources.length) {
        return [textDisplay('No log sources have been created yet.')];
    }

    return sources.flatMap((source, index) => {
        const row = section(
            [
                textDisplay(
                    lines(
                        `**${source.sourceID}**`,
                        `Level \`${source.level}\``,
                        `${source.logsSize.toLocaleString()}/${source.logsLimit.toLocaleString()} entries`
                    )
                )
            ],
            actionButton('Export Logs', `${LogsPanelIDs.ExportSourcePrefix}${source.sourceID}`)
        );

        return index === sources.length - 1 ? [row] : [row, separator()];
    });
}

function buildSelectedSourceControls(sources, source) {
    return [
        textDisplay(
            source
                ? lines('### Configure Log Level', `Selected source: \`${source.sourceID}\``)
                : lines('### Configure Log Level', 'Choose a source to change its minimum retained log level.')
        ),
        actionRow(
            stringSelect(
                LogsPanelIDs.SourceSelect,
                sources.map((option) => ({
                    label: option.sourceID,
                    value: option.sourceID,
                    description: `${option.logsSize.toLocaleString()} entries at ${option.level}`,
                    default: option.sourceID === source?.sourceID
                })),
                'Choose source to configure'
            )
        ),
        ...(source
            ? [
                  actionRow(
                      stringSelect(
                          `${LogsPanelIDs.LevelPrefix}${source.sourceID}`,
                          Object.values(LogLevels).map((level) => ({
                              label: level,
                              value: level,
                              description: `Keep ${level} and higher logs.`,
                              default: source.level === level
                          })),
                          'Set minimum level for selected source'
                      )
                  )
              ]
            : [])
    ];
}

function buildJsonFileMessage(prefix, data) {
    return {
        flags: MessageFlags.Ephemeral,
        files: [jsonFile(`${prefix}-${getTimestampForFilename()}.json`, data)]
    };
}

function getCustomIDValue(context, route) {
    return context.customID.slice(route.prefix.length);
}

function getLogSource(context, logging, sourceID) {
    return getLogSources(context, logging).find((source) => source.sourceID === sourceID);
}

function getLogSources(context, logging) {
    return logging.getSources().filter((source) => !context.modules.get(source.sourceID));
}
