const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["report"],

	emoji: '📮',

	execute: async function() {
		if (!this.msg.args.length) {
			this.error(", please include something to report!");
			return;
		}

        // check for mentions
        let mentions = [];
		this.msg.mentions.forEach((member) => {
			mentions.push(member.id);
		});
        
        // build report
        let report = await this.db.Report.create({
            sender: this.msg.author.id,
            message: this.msg.args.join(" "),
            mentions: mentions
        });

        // build message
        let content = null;
        if (report.mentions) {
            content = report.mentions.join(",");
        }

        let embed = {
            "color": 10590193,
            "timestamp": new Date(),
            "author": {
                "name": "Snail Messaging Service",
                "icon_url":this.bot.user.avatarURL
            },
            "fields": [
                {
                    "name":"A user sent a feedback!",
                    "value": "==============================================="
                },{
                    "name": "Message ID",
                    "value": report._id,
                    "inline": true
                },{
                    "name": `From ${this.msg.author.username}(${this.msg.author.id})`,
                    "value": "```"+report.message+"```\n\n==============================================="
                }
            ]
        };

        // send to log channel and user channel
        await this.bot.createMessage(this.bot.config.channels.log, {content: content, embed: embed});
        await this.reply(", Thanks for the report, it has been sent to server staff!");
    }

});