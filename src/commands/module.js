import { LogLevels } from '../modules/index.js';
import {
    accentContainer,
    actionButton,
    actionRow,
    ButtonStyle,
    componentsMessage,
    ephemeralText,
    MessageFlags,
    section,
    separator,
    stringSelect,
    textDisplay
} from '../systems/discord/components.js';
import { auth, getColor, getOptionValue, lines } from '../utils.js';

export const ModulePanelIDs = Object.freeze({
    LogLevelPrefix: 'module_panel:log_level:',
    LogsPrefix: 'module_panel:logs:',
    OpenPrefix: 'module_panel:open:',
    StatePrefix: 'module_panel:state:',
    TogglePrefix: 'module_panel:toggle:'
});

const ModuleStatus = Object.freeze({
    Active: {
        label: 'Active',
        color: 'success'
    },
    Disabled: {
        label: 'Disabled',
        color: 'neutral'
    }
});

export default {
    auth: auth.manager,
    staff: true,
    definition: {
        name: 'module',
        description: 'Open module status and settings.',
        options: [
            {
                name: 'module',
                description: 'Module to inspect.',
                type: 3,
                autocomplete: true,
                required: false
            }
        ]
    },
    autocomplete(context) {
        const focused = getFocusedOptionValue(context.data).toLowerCase();

        return context.modules.sorted
            .filter((module) => module.id.includes(focused) || module.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map((module) => ({
                name: `${module.name} (${module.id})`,
                value: module.id
            }));
    },
    components: [
        {
            prefix: ModulePanelIDs.TogglePrefix,
            auth: auth.manager,
            handle: toggleModule
        },
        {
            prefix: ModulePanelIDs.OpenPrefix,
            auth: auth.manager,
            handle: openModulePanel
        },
        {
            prefix: ModulePanelIDs.LogsPrefix,
            auth: auth.manager,
            handle: sendModuleLogs
        },
        {
            prefix: ModulePanelIDs.StatePrefix,
            auth: auth.manager,
            handle: sendModuleState
        },
        {
            prefix: ModulePanelIDs.LogLevelPrefix,
            auth: auth.manager,
            handle: setModuleLogLevel
        }
    ],

    async handle(context) {
        const moduleID = getOptionValue(context.data, 'module');
        if (!moduleID) {
            await context.respond(buildModuleOverview(context));
            return;
        }

        const module = context.modules.get(moduleID);

        if (!module) {
            await context.respond('Choose a valid module.');
            return;
        }

        await context.respond(buildModulePanel(context, module));
    }
};

export function buildModuleOverview(context) {
    const modules = context.modules.sorted;
    const statusCounts = countStatuses(modules);

    return componentsMessage(
        accentContainer(
            getColor(context, 'primary'),
            textDisplay(
                lines(
                    '## Modules',
                    [`**Active:** ${statusCounts.Active}`, `**Disabled:** ${statusCounts.Disabled}`].join('  ')
                )
            ),
            separator(),
            ...buildModuleOverviewSections(modules)
        )
    );
}

export function buildModulePanel(context, module) {
    const status = getModuleStatus(module);

    return componentsMessage(
        accentContainer(
            getColor(context, status.color),
            ...(module.description ? [textDisplay(lines(`## ${module.name}`, module.description))] : []),
            ...buildModuleRuntimeSections(module, status),
            ...module.panelComponents()
        )
    );
}

export function buildModuleLogsFileMessage(module) {
    const filename = `${module.id}-logs-${getTimestampForFilename()}.json`;

    return {
        flags: MessageFlags.Ephemeral,
        files: [jsonFile(filename, module.getLogs())]
    };
}

export function buildModuleStateFileMessage(module) {
    const filename = `${module.id}-state-${getTimestampForFilename()}.json`;

    return {
        flags: MessageFlags.Ephemeral,
        files: [jsonFile(filename, module.state())]
    };
}

export function getModuleActionID(prefix, moduleID) {
    return `${prefix}${moduleID}`;
}

function countStatuses(modules) {
    return modules.reduce(
        (counts, module) => {
            counts[getModuleStatus(module).label]++;
            return counts;
        },
        { Active: 0, Disabled: 0 }
    );
}

function buildModuleRuntimeSections(module, status) {
    const state = module.state();
    const statusLabel = module.toggleable ? status.label : 'Always on';
    const toggleButtonLabel = module.toggleable ? (module.enabled ? 'Disable' : 'Enable') : 'Always On';
    const sections = [
        section(
            [textDisplay(lines('**Status**', statusLabel, `\`${module.id}\``))],
            actionButton(toggleButtonLabel, getModuleActionID(ModulePanelIDs.TogglePrefix, module.id), {
                disabled: !module.toggleable,
                style: module.enabled ? ButtonStyle.Danger : ButtonStyle.Success
            })
        ),
        section(
            [
                textDisplay(
                    lines(
                        '**Logs**',
                        `${state.logsSize.toLocaleString()}/${state.logsLimit.toLocaleString()} entries`,
                        `Level \`${state.logLevel}\``
                    )
                )
            ],
            actionButton('View Logs', getModuleActionID(ModulePanelIDs.LogsPrefix, module.id))
        ),
        actionRow(actionButton('Export State', getModuleActionID(ModulePanelIDs.StatePrefix, module.id))),
        actionRow(
            stringSelect(
                getModuleActionID(ModulePanelIDs.LogLevelPrefix, module.id),
                buildLogLevelOptions(module),
                'Set log level'
            )
        )
    ];

    return sections;
}

function buildLogLevelOptions(module) {
    return Object.values(LogLevels).map((level) => ({
        label: level,
        value: level,
        description: `Keep ${level} and higher logs.`,
        default: module.logLevel === level
    }));
}

function buildModuleOverviewSections(modules) {
    if (!modules.length) {
        return [textDisplay('No modules are registered.')];
    }

    return modules.flatMap((module, index) => {
        const state = module.state();
        const status = getModuleStatus(module);
        const details = [
            `**${module.name}**`,
            `${status.label}  |  \`${module.id}\``,
            state.description,
            `Logs ${state.logsSize.toLocaleString()}/${state.logsLimit.toLocaleString()}`
        ].filter(Boolean);
        const row = section(
            [textDisplay(lines(...details))],
            actionButton('Open', getModuleActionID(ModulePanelIDs.OpenPrefix, module.id), {
                style: ButtonStyle.Primary
            })
        );

        return index === modules.length - 1 ? [row] : [row, separator()];
    });
}

async function toggleModule(context, route) {
    const module = await getActionModule(context, route);
    if (!module) {
        return;
    }

    if (!module.toggleable) {
        await context.respond(ephemeralText('That module is always on.'));
        return;
    }

    if (module.enabled) {
        await context.modules.disable(module);
    } else {
        await context.modules.enable(module, context);
    }

    await context.edit(buildModulePanel(context, module));
}

async function openModulePanel(context, route) {
    const module = await getActionModule(context, route);
    if (!module) {
        return;
    }

    await context.edit(buildModulePanel(context, module));
}

async function sendModuleLogs(context, route) {
    const module = await getActionModule(context, route);
    if (!module) {
        return;
    }

    await context.respond(buildModuleLogsFileMessage(module));
}

async function sendModuleState(context, route) {
    const module = await getActionModule(context, route);
    if (!module) {
        return;
    }

    await context.respond(buildModuleStateFileMessage(module));
}

async function setModuleLogLevel(context, route) {
    const module = await getActionModule(context, route);
    const level = context.data.values?.[0];

    if (!module) {
        return;
    }

    if (!level || module.LogLevelWeights[level] === undefined) {
        await context.respond(ephemeralText('Choose a valid log level.'));
        return;
    }

    await module.setLogLevel(level);
    await context.edit(buildModulePanel(context, module));
}

async function getActionModule(context, route) {
    const module = context.modules.get(context.customID.slice(route.prefix.length));

    if (!module) {
        await context.respond(ephemeralText('Choose a valid module.'));
    }

    return module;
}

function jsonFile(filename, data) {
    return {
        name: filename,
        blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    };
}

function getTimestampForFilename() {
    return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function getFocusedOptionValue(data) {
    const focused = data.options?.find((option) => option.focused);

    return typeof focused?.value === 'string' ? focused.value : '';
}

function getModuleStatus(module) {
    if (module.active) {
        return ModuleStatus.Active;
    }

    return ModuleStatus.Disabled;
}
