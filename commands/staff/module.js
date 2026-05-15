const Command = require('../Command');
const { hasManagerPerms } = require('../../util');

const TOGGLE_OPTIONS = ['enable', 'disable'];

module.exports = new Command({
    aliases: ['module', 'modules'],
    group: 'Staff',
    auth: hasManagerPerms,
    usage: '[module|modules] (enable|disable) {moduleID}',
    description: 'View and manage Snail\'s modules.',
    examples: [
        'modules',
        'module command_handler',
        'module enable logger',
        'module disable logger',
    ],
    execute: async function (ctx) {
        if (ctx.name == 'modules') {
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

            return await ctx.send({
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

        // Check if toggling
        let option;
        let moduleID = ctx.args.shift()?.toLowerCase();

        if (TOGGLE_OPTIONS.includes(moduleID)) {
            option = moduleID;
            moduleID = ctx.args.shift()?.toLowerCase();
        }

        if (!moduleID) return await ctx.error('please provide a module ID!');

        const module = ctx.bot.modules[moduleID];
        if (!module) {
            return await ctx.error(`I don't have a module with the ID \`${moduleID}\`. Use \`${ctx.bot.config.prefixes[0]} modules\` to view my modules and their IDs!`);
        }

        if (option) {
            if (!module.toggleable) return await ctx.error('Nice try! You can\'t toggle that module ;)');

            if (option == 'enable') {
                if (module.enabled) return await ctx.error(`\`${module.id}\` is already enabled.`);
                await module.enable();
            } else {
                if (!module.enabled) return await ctx.error(`\`${module.id}\` is already disabled.`);
                await module.disable();
            }
        }

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
                    }
                ],
                timestamp: new Date(),
                color: ctx.bot.config.colors.embed
            }]
        });
    },
});
