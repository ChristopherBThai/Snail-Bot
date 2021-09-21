const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["report"],

 	emoji: '📮',

 	execute: async function() {
		this.error(", this command is deprecated!");
		return;
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
		let author = await this.db.User.updateOne(
			{ _id: this.msg.author.id },
			{},
			{ upsert: true }
		);
		let report = await this.db.Report.create({
			sender: author,
			message: this.msg.args.join(" "),
			mentions: mentions
		});

		// build message
		let content = null;
		if (mentions) {
			content = mentions.join(", ");
		}

		let embed = {
			"color": 16698700,
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
		await this.bot.createMessage(this.bot.config.channels.report, {content: content, embed: embed});
		await this.reply(", Thanks for the report, it has been sent to server staff!");
	}

});
