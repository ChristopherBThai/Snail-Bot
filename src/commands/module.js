import { LogLevels, LogLevelWeights } from '../modules/index.js';
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
import { auth, getColor, getOptionValue, getTimestampForFilename, jsonFile, lines } from '../utils.js';

export const ModulePanelIDs = Object.freeze({
    LogLevelPrefix: 'module_panel:log_level:',
    LogsPrefix: 'module_panel:logs:',
    OpenPrefix: 'module_panel:open:',
    PagePrefix: 'module_panel:page:',
    StatePrefix: 'module_panel:state:',
    TogglePrefix: 'module_panel:toggle:'
});
export const ModuleRuntimePageID = 'runtime';

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
            prefix: ModulePanelIDs.PagePrefix,
            auth: auth.manager,
            handle: openModulePanelPage
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

export function buildModulePanel(context, module, { pageID } = {}) {
    const status = getModuleStatus(module);
    const pages = buildModulePanelPages(context, module, status);
    const page = getSelectedPanelPage(module, pages, pageID);

    return componentsMessage(
        accentContainer(
            getColor(context, status.color),
            ...(module.description ? [textDisplay(lines(`## ${module.name}`, module.description))] : []),
            ...(pages.length > 1 ? [buildModulePanelNavigation(module, pages, page.id), separator()] : []),
            ...page.components
        )
    );
}

function buildJsonFileMessage(prefix, data) {
    return {
        flags: MessageFlags.Ephemeral,
        files: [jsonFile(`${prefix}-${getTimestampForFilename()}.json`, data)]
    };
}

export function getModuleActionID(prefix, moduleID) {
    return `${prefix}${moduleID}`;
}

export function getModulePageActionID(moduleID, pageID) {
    return `${ModulePanelIDs.PagePrefix}${moduleID}:${pageID}`;
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
            [textDisplay(lines(`**Status**  \`${module.id}\``, `${statusLabel} module.`))],
            actionButton(toggleButtonLabel, getModuleActionID(ModulePanelIDs.TogglePrefix, module.id), {
                disabled: !module.toggleable,
                style: module.enabled ? ButtonStyle.Danger : ButtonStyle.Success
            })
        ),
        separator(),
        section(
            [
                textDisplay(
                    lines(
                        '**State Export**',
                        'Download the full current module state as JSON for inspection or debugging.'
                    )
                )
            ],
            actionButton('Export State', getModuleActionID(ModulePanelIDs.StatePrefix, module.id))
        ),
        separator(),
        section(
            [
                textDisplay(
                    lines('**Logs**', `${state.logsSize.toLocaleString()}/${state.logsLimit.toLocaleString()} entries`)
                )
            ],
            actionButton('Export Logs', getModuleActionID(ModulePanelIDs.LogsPrefix, module.id))
        ),
        separator(),
        textDisplay('**Log Level**'),
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

function buildModulePanelPages(context, module, status) {
    const modulePages = module.panelPages(context).filter((page) => page?.id && page?.label);

    return [
        {
            id: ModuleRuntimePageID,
            label: 'Runtime',
            components: buildModuleRuntimeSections(module, status)
        },
        ...modulePages.map((page) => ({
            ...page,
            components: page.components ?? []
        }))
    ];
}

function buildModulePanelNavigation(module, pages, activePageID) {
    return actionRow(
        ...pages.slice(0, 5).map((page) =>
            actionButton(page.label, getModulePageActionID(module.id, page.id), {
                disabled: page.id === activePageID,
                style: page.id === activePageID ? ButtonStyle.Primary : ButtonStyle.Secondary
            })
        )
    );
}

function getSelectedPanelPage(module, pages, pageID) {
    const defaultPageID = module.panelDefaultPageID?.() ?? pages.find((page) => page.id !== ModuleRuntimePageID)?.id;

    return pages.find((page) => page.id === (pageID ?? defaultPageID)) ?? pages[0];
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

    await context.edit(buildModulePanel(context, module, { pageID: ModuleRuntimePageID }));
}

async function openModulePanel(context, route) {
    const module = await getActionModule(context, route);
    if (!module) {
        return;
    }

    await context.edit(buildModulePanel(context, module));
}

async function openModulePanelPage(context, route) {
    const { module, pageID } = await getPageAction(context, route);
    if (!module) {
        return;
    }

    await context.edit(buildModulePanel(context, module, { pageID }));
}

async function sendModuleLogs(context, route) {
    const module = await getActionModule(context, route);
    if (!module) {
        return;
    }

    await context.respond(buildJsonFileMessage(`${module.id}-logs`, module.getLogs()));
}

async function sendModuleState(context, route) {
    const module = await getActionModule(context, route);
    if (!module) {
        return;
    }

    await context.respond(buildJsonFileMessage(`${module.id}-state`, module.state()));
}

async function setModuleLogLevel(context, route) {
    const module = await getActionModule(context, route);
    const level = context.data.values?.[0];

    if (!module) {
        return;
    }

    if (!level || LogLevelWeights[level] === undefined) {
        await context.respond(ephemeralText('Choose a valid log level.'));
        return;
    }

    await module.setLogLevel(level);
    await context.edit(buildModulePanel(context, module, { pageID: ModuleRuntimePageID }));
}

async function getActionModule(context, route) {
    const module = context.modules.get(context.customID.slice(route.prefix.length));

    if (!module) {
        await context.respond(ephemeralText('Choose a valid module.'));
    }

    return module;
}

async function getPageAction(context, route) {
    const value = context.customID.slice(route.prefix.length);
    const separatorIndex = value.indexOf(':');
    const moduleID = separatorIndex === -1 ? value : value.slice(0, separatorIndex);
    const pageID = separatorIndex === -1 ? undefined : value.slice(separatorIndex + 1);
    const module = context.modules.get(moduleID);

    if (!module) {
        await context.respond(ephemeralText('Choose a valid module.'));
    }

    return { module, pageID };
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
