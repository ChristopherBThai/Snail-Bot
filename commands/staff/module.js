const Command = require('../Command');
const { hasManagerPerms } = require('../../util');

module.exports = new Command({
    aliases: ['module', 'modules'],
    group: 'Staff',
    auth: hasManagerPerms,
    usage: '[module|modules] {moduleID} [enable|disable|logs|loglevel] {level}',
    description: 'View and manage Snail\'s modules.',
    examples: [
        'modules',
        'module command_handler',
        'module command_handler logs',
        'module command_handler loglevel debug',
        'module logger enable',
        'module logger disable',
    ],
    execute: async function (ctx) {
        if (ctx.name == 'modules') return await displayModules(ctx);

        const moduleID = ctx.args.shift()?.toLowerCase();
        const option = ctx.args.shift()?.toLowerCase();
        const value = ctx.args.shift()?.toLowerCase();

        if (!moduleID) return await ctx.error('please provide a module ID!');

        const module = ctx.bot.modules[moduleID];
        if (!module) {
            return await ctx.error(`I don't have a module with the ID \`${moduleID}\`. Use \`${ctx.bot.config.prefixes[0]} modules\` to view my modules and their IDs!`);
        }

        switch (option) {
            case undefined: {
                return await displayModule(ctx, module);
            }
            case 'logs': {
                return await exportLogs(ctx, module);
            }
            case 'loglevel': {
                return await updateLogLevel(ctx, module, value);
            }
            case 'enable':
            case 'disable': {
                return await toggleModule(ctx, module, option);
            }
            default: {
                return await ctx.error(`\`${option}\` is not a valid option!`);
            }
        }
    },
});

async function displayModules(ctx) {
    const modules = Object.values(ctx.bot.modules)
        .sort((a, b) => a.id.localeCompare(b.id));

    const enabled = [];
    const disabled = [];
    const alwaysOn = [];

    for (const module of modules) {
        const text = `\`${module.id}\``;

        if (!module.toggleable) alwaysOn.push(text);
        else if (module.enabled) enabled.push(text);
        else disabled.push(text);
    }

    await ctx.send({
        embeds: [{
            title: 'Modules',
            fields: [
                {
                    name: '🟢 Enabled',
                    value: enabled.join(' ') || '*none*',
                    inline: false
                },
                {
                    name: '🟡 Always On',
                    value: alwaysOn.join(' ') || '*none*',
                    inline: false
                },
                {
                    name: '🔴 Disabled',
                    value: disabled.join(' ') || '*none*',
                    inline: false
                }
            ],
            timestamp: new Date(),
            color: ctx.bot.config.colors.embed
        }]
    });
}

async function displayModule(ctx, module) {
    await ctx.send({
        embeds: [{
            title: module.name,
            description: module.description,
            fields: [
                {
                    name: 'ID',
                    value: `\`${module.id}\``,
                    inline: true
                },
                {
                    name: 'Status',
                    value: !module.toggleable 
                        ? '🟡 Always On' 
                        : (module.enabled ? '🟢 Enabled' : '🔴 Disabled'),
                    inline: true
                },
                {
                    name: 'Logs',
                    value: `${module.logsSize.toLocaleString()}/${module.logsLimit.toLocaleString()}`,
                    inline: true
                },
                {
                    name: 'Log Level',
                    value: module.logLevel,
                    inline: true
                }
            ],
            timestamp: new Date(),
            color: ctx.bot.config.colors.embed
        }]
    });
}

async function exportLogs(ctx, module) {
    const logs = module.getLogs();
    const exportedAt = new Date().toISOString();
    const content = JSON.stringify(logs, null, 2);
    const file = {
        file: Buffer.from(content),
        name: `${module.id}-logs-${exportedAt.replace(/[:.]/g, '-')}.json`
    };

    await ctx.send(`Exported \`${module.id}\` logs (${logs.length.toLocaleString()}).`, file);
}

async function toggleModule(ctx, module, option) {
    if (!module.toggleable) return await ctx.error('Nice try! You can\'t toggle that module ;)');

    if (option == 'enable') {
        if (module.enabled) return await ctx.error(`\`${module.id}\` is already enabled.`);
        await module.enable();
    } else {
        if (!module.enabled) return await ctx.error(`\`${module.id}\` is already disabled.`);
        await module.disable();
    }

    await displayModule(ctx, module);
}

async function updateLogLevel(ctx, module, level) {
    if (!level) return await ctx.error('please provide a log level!');
    if (module.LogLevelWeights[level] === undefined) {
        return await ctx.error(`\`${level}\` is not a valid log level!`);
    }

    await module.setAndSaveLogLevel(level);
    await displayModule(ctx, module);
}
