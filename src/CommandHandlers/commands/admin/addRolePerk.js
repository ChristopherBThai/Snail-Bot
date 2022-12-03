const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({
	alias: ['addroleperk'],

	emoji: '⚙️',

	mods: true,

	execute: async function () {
		return this.error(', this command is no longer available.');
		// Validation
		if (this.msg.args.length < 2) {
			this.error(', wrong arguments');
			return;
		}
		let mention = this.msg.mentions[0];
		if (!mention) {
			this.error(', wrong mention');
			return;
		}
		let months = parseInt(this.msg.args[1]);
		if (!months) {
			this.error(', wrong arguments');
			return;
		}

		// Add perks
		const user = await this.db.User.findById(mention.id);
		// If user already has benefits
		if (user && this.global.hasBenefit(user.roleBenefit)) {
			await this.db.User.updateOne(
				{ _id: mention.id },
				{ $inc: { 'roleBenefit.months': months } }
			);

			// Doesn't have benefits
		} else {
			await this.db.User.updateOne(
				{ _id: mention.id },
				{
					roleBenefit: {
						months: months,
						started: new Date(),
					},
				},
				{ upsert: true }
			);
		}

		const userDm = await this.bot.getDMChannel(mention.id);
		await userDm.createMessage(
			`Your role perks have been extended by **${months} months**\nYou can change your role by typing \`snail changerole {hexcode} {roleName}\` on the **OwO Bot Support** server`
		);
		await this.reply(
			`, increased role benefits by **${months} months** for **${mention.username}#${mention.discriminator}**`
		);
	},
});

// TODO command to check if expired perks are there
