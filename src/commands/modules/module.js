const Command = require('../Command.js');

module.exports = new Command({
    alias: ['module', 'modules'],

    group: 'Module',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail [module|modules] (enable|disable) {moduleID}',

    description: "View Snail's modules and their status or get detailed information on a specific module!",

    examples: ['snail modules', 'snail module questlist'],

    execute: async function () {
        switch (this.message.command) {
            case 'module': {
                let option;
                let moduleID;

                switch (this.message.args[0]?.toLowerCase()) {
                    case 'enable':
                    case 'disable': {
                        option = this.message.args.shift()?.toLowerCase();
                        moduleID = this.message.args.shift()?.toLowerCase();
                        break;
                    }
                    default: {
                        moduleID = this.message.args.shift()?.toLowerCase();
                    }
                }

                const module = this.bot.modules[moduleID];

                if (!module) {
                    await this.error(
                        `I don't have a module with the ID \`${moduleID}\`. Use \`snail modules\` to view my modules and their IDs!`
                    );
                    return;
                }

                if (option) {
                    if (!module.toggleable) {
                        await this.error(`Nice try! You can't toggle that module ;)`);
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
                    color: this.config.embedcolor,
                    description: `${module.description}\n\n${module.getConfigurationOverview()}`,
                };

                await this.send({ embed });
                break;
            }
            case 'modules': {
                const embed = {
                    title: 'Modules',
                    color: this.config.embedcolor,
                    description: '',
                };

                for (const { enabled, name, id } of Object.values(this.bot.modules)) {
                    embed.description += `${enabled ? '✅' : '❌'} ${name} \`${id}\`\n`;
                }

                await this.send({ embed });
                break;
            }
        }
    },
});
