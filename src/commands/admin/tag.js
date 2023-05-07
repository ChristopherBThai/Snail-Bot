const CommandInterface = require('../CommandInterface.js');
const global = require('../../utils/permissions.js');

module.exports = new CommandInterface({
    alias: ['tag'],

    emoji: '🏷️',

    group: "util",

    cooldown: 15000,

    usage: "snail tag {tag}",

    description: "View an existing tag",

    execute: async function () {
        let subcommand = this.message.args[0];
        let tagName = this.message.args[1];
        let data = this.message.args.splice(2).join(" ");
        let tag = null;

        if (["add", "edit", "delete", "raw"].includes(subcommand)) {
            // Only admins can add/edit/delete/view raw tags
            if (!global.hasAdminPerms(this.message.member)) {
                this.error(', you do not have permission to use this command!');
                return;
            }

            // add/edit/delete/raw subcommands require a tag name
            if (!tagName) {
                this.error(`, please provide a tag name!`);
                return;
            }

            // All subcommands will need to check wether this exists or not anyway, so I'm fetching it out here instead of inside each switch branch
            tag = await this.bot.snail_db.Tag.findById(tagName);
        } else {
            // If the first arg wasn't one of the subcommands, then it is the tag name
            tag = await this.bot.snail_db.Tag.findById(subcommand);
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

            tagName = tagName.toLowerCase();

            if (!/^[a-z0-9]+$/.test(tagName)) {
                this.error(`, tag names can only contain alphanumeric characters!`);
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
                    await this.snail_db.Tag.create({ _id: tagName, data });
                } catch (error) {
                    console.log(error);
                    this.error(`There was a problem creating the \`${tagName}\` tag. Try again later or check the logs!`);
                    break;
                }

                await this.reply(`, I created the tag \`${tagName}\`!`);
                break;
            }
            case "edit": {
                try {
                    await this.snail_db.Tag.updateOne({ _id: tagName }, { data });
                } catch (error) {
                    console.log(error);
                    this.error(`There was a problem updating the \`${tagName}\` tag. Try again later or check the logs!`);
                    break;
                }

                await this.reply(`, I updated the tag \`${tagName}\`!`);
                break;
            }
            case "delete": {
                try {
                    await this.snail_db.Tag.deleteOne({ _id: tagName });
                } catch (error) {
                    console.log(error);
                    this.error(`There was a problem deleting the \`${tagName}\` tag. Try again later or check the logs!`);
                    break;
                }

                await this.reply(`, I deleted the tag \`${tagName}\`!`);
                break;
            }
            case "raw": {
                this.bot.createMessage(this.message.channel.id, `\`\`\`\n${tag.data}\n\`\`\``);
                break;
            }
            default: {
                this.bot.createMessage(this.message.channel.id, tag.data);
                break;
            }
        }
    }
});