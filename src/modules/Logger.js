const { hasManagerPerms } = require("../utils/permissions");
const { parseUserID } = require("../utils/global");

const DYNO_PREFIX = "?";
const DURATION_REGEX = /^\d+[mhdw]/;

module.exports = class Logger extends require("./Module") {
    constructor(bot) {
        super(bot, {
            id: "logger",
            name: "Logger",
            description: `Logs stuff 1984 style.`,
            toggleable: true
        });

        // Defaults
        this.publicChannel = undefined;
        this.privateChannel = undefined;
        this.tracking = {
            dyno: false
        };

        this.addEvent("UserMessage", this.checkModerationCommand);
    }

    async onceReady() {
        await super.onceReady();

        this.publicChannel = await this.bot.getConfiguration(`${this.id}_public_channel`) ?? this.publicChannel;
        this.privateChannel = await this.bot.getConfiguration(`${this.id}_private_channel`) ?? this.privateChannel;

        this.tracking = {
            dyno: await this.bot.getConfiguration(`${this.id}_tracking_dyno`) ?? this.tracking.dyno,
        }
    }

    async checkModerationCommand(message) {
        if (!this.tracking.dyno) return;
        if (!message.content.toLowerCase().startsWith(DYNO_PREFIX)) return;
        if (!hasManagerPerms(message.member)) return;

        // Dyno splits at every space interestingly enough
        let args = message.content.slice(DYNO_PREFIX.length).trim().split(" ");
        let command = args.shift()?.toLowerCase();

        let USER_ID;
        let REASON;
        let DURATION;

        switch (command) {
            case "warn": {
                USER_ID = parseUserID(args.shift());
                REASON = args.length ? args.join(" ") : undefined;

                if (!REASON) return;
                if (!(await this.bot.getUser(USER_ID))) return;
                break;
            }
            case "marketban": {
                USER_ID = parseUserID(args.shift());
                REASON = args.length ? args.join(" ") : undefined;

                if (!(await this.bot.getUser(USER_ID))) return;
                break;
            }
            case "mute": {
                USER_ID = parseUserID(args.shift());
                DURATION = args.shift()?.match(DURATION_REGEX)?.[0];
                REASON = args.length ? args.join(" ") : undefined;

                if (!DURATION) return;
                if (!(await this.bot.getUser(USER_ID))) return;
                break;
            }
            case "kick": {
                USER_ID = parseUserID(args.shift());
                REASON = args.length ? args.join(" ") : undefined;

                if (!(await this.bot.getUser(USER_ID))) return;
                break;
            }
            case "ban": {
                // Dyno is case sensitive for these
                if (args[0] == "save" || args[0] == "noappeal") args.shift();
                USER_ID = parseUserID(args.shift());
                DURATION = args.shift()?.match(DURATION_REGEX)?.[0];
                REASON = args.length ? args.join(" ") : undefined;

                if (!DURATION) return;
                if (!(await this.bot.getUser(USER_ID))) return;
                break;
            }
            case "unmute": {
                USER_ID = parseUserID(args.shift());
                REASON = args.length ? args.join(" ") : undefined;

                if (!(await this.bot.getUser(USER_ID))) return;
                break;
            }
            case "unban": {
                USER_ID = parseUserID(args.shift());
                REASON = args.length ? args.join(" ") : undefined;

                if (!(await this.bot.getUser(USER_ID))) return;
                break;
            }
            default: return;
        }

        const embed = {
            title: `**${command.charAt(0).toUpperCase() + command.slice(1)}**`,
            description: `**• User:** <@${USER_ID}> (\`${USER_ID}\`)\n`
        }

        if (DURATION) embed.description += `**• Duration:** ${DURATION}\n`;

        embed.description += `**• Reason:** ${REASON ?? "No reason provided"}`

        switch (command) {
            case "unmute":
            case "unban": embed.color = this.bot.config.color.green; break;
            case "warn": embed.color = this.bot.config.color.yellow; break;
            case "marketban":
            case "mute":
            case "kick": embed.color = this.bot.config.color.orange; break;
            case "ban": embed.color = this.bot.config.color.red; break;
        }

        await this.publicLog({ embed });
        await message.addReaction("📝");
    }

    async publicLog(message) {
        if (this.publicChannel) await this.bot.createMessage(this.publicChannel, message);
        else console.log(`Log attempt failed (No Public Channel Set): ${message}`);
    }

    async privateLog(message) {
        if (this.privateChannel) await this.bot.createMessage(this.privateChannel, message);
        else console.log(`Log attempt failed (No Private Channel Set): ${message}`);
    }

    getConfigurationOverview() {
        return `${super.getConfigurationOverview()}\n` +
        `- Public Channel: <#${this.publicChannel}>\n` +
        `- Private Channel: <#${this.privateChannel}>\n` +
        `- Tracking\n` +
        ` - Dyno: ${this.tracking.dyno}\n`
    }
}

