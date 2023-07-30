const Command = require('../Command.js');

module.exports = new Command({
    alias: ['module', 'modules'],

    group: 'Module',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail [module|modules] (enable|disable) {moduleID}',

    description: "View Snail's modules and their status or get detailed information on a specific module!",

    examples: ['snail modules', 'snail module questlist'],

    execute: async function (ctx) {
        switch (ctx.command) {
            case 'module': {
                let option;
                let moduleID;

                switch (ctx.args[0]?.toLowerCase()) {
                    case 'enable':
                    case 'disable': {
                        option = ctx.args.shift()?.toLowerCase();
                        moduleID = ctx.args.shift()?.toLowerCase();
                        break;
                    }
                    default: {
                        moduleID = ctx.args.shift()?.toLowerCase();
                    }
                }

                if (!moduleID) {
                    await ctx.error(`Please provide a module ID. Use \`snail modules\` to view my modules and their IDs!`);
                    return;
                }

                const module = ctx.bot.modules[moduleID];

                if (!module) {
                    await ctx.error(`I don't have a module with the ID \`${moduleID}\`. Use \`snail modules\` to view my modules and their IDs!`);
                    return;
                }

                if (option) {
                    if (!module.toggleable) {
                        await ctx.error(`Nice try! You can't toggle that module ;)`);
                        return;
                    }

                    if (option == 'enable') {
                        await module.enable();
                    } else if (option == 'disable') {
                        await module.disable();
                    }
                }

                const embed = {
                    title: module.name,
                    color: ctx.config.embedcolor,
                    description: `${module.description}\n\n${module.getConfigurationOverview()}`,
                };

                await ctx.send({ embed });
                break;
            }
            case 'modules': {
                const embed = {
                    title: 'Modules',
                    color: ctx.config.embedcolor,
                    description: '',
                };

                for (const { enabled, name, id } of Object.values(ctx.bot.modules)) {
                    embed.description += `${enabled ? '✅' : '❌'} ${name} \`${id}\`\n`;
                }

                await ctx.send({ embed });
                break;
            }
        }
    },
});
