const CommandInterface = require('../../CommandInterface.js');
const global = require('../../../utils/global.js');

module.exports = new CommandInterface({
    alias: ['tag'],

    emoji: '🏷️',

    execute: async function () {
        let subcommand = this.msg.args[0];
        let tag_name = this.msg.args[1];
        let data = this.msg.args.splice(2).join(" ");
        let tag = null;

        if (["add", "edit", "delete", "raw"].includes(subcommand)) {
            // Only admins can add/edit/delete/view raw tags
            if (!global.hasAdminPerms(this.msg.member)) {
                this.error(', you do not have permission to use this command!');
                return;
            }

            // add/edit/delete/raw subcommands require a tag name
            if (!tag_name) {
                this.error(`, please provide a tag name!`);
                return;
            }

            // All subcommands will need to check wether this exists or not anyway, so I'm fetching it out here instead of inside each switch branch
            tag = await this.bot.db.Tag.findById(tag_name);
        } else {
            // If the first arg wasn't one of the subcommands, then it is the tag name
            tag = await this.bot.db.Tag.findById(subcommand);
        }

        if (["add", "edit"].includes(subcommand)) {
            // add/edit subcommands require data
            if (!data) {
                this.error(`, please provide some data for the tag!`);
                return;
            }
        }

        if (subcommand == "add") {
            // add subcommand requires the tag to not exist
            if (tag) {
                this.error(`, that tag already exists!`);
                return;
            }
        } else {
            // all other paths require the tag to exist
            if (!tag) {
                this.error(`, that tag does not exist!`);
                return;
            }
        }

        switch (subcommand) {
            case "add": {
                try {
                    await this.db.Tag.create({ _id: tag_name, data });
                } catch (error) {
                    console.log(error);
                    this.error(`There was a problem creating the \`${tag_name}\` tag. Try again later or check the logs!`);
                    break;
                }

                await this.reply(`, I created the tag \`${tag_name}\`!`);
                break;
            }
            case "edit": {
                try {
                    await this.db.Tag.updateOne({ _id: tag_name }, { data });
                } catch (error) {
                    console.log(error);
                    this.error(`There was a problem updating the \`${tag_name}\` tag. Try again later or check the logs!`);
                    break;
                }

                await this.reply(`, I updated the tag \`${tag_name}\`!`);
                break;
            }
            case "delete": {
                try {
                    await this.db.Tag.deleteOne({ _id: tag_name });
                } catch (error) {
                    console.log(error);
                    this.error(`There was a problem deleting the \`${tag_name}\` tag. Try again later or check the logs!`);
                    break;
                }

                await this.reply(`, I deleted the tag \`${tag_name}\`!`);
                break;
            }
            case "raw": {
                this.bot.createMessage(this.msg.channel.id, `\`\`\`\n${tag.data}\n\`\`\``);
                break;
            }
            default: {
                this.bot.createMessage(this.msg.channel.id, tag.data);
                break;
            }
        }
    }
});