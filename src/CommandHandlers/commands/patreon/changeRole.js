const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["changerole", "cr", "role"],

	emoji: '🏷️',

	execute: async function() {

		if (!this.global.hasRoles(this.msg.member, this.config.roles.role_change)) {
			this.error(", you don't have Patreon perks to change your roles!");
			return;
		}

		if (this.msg.args.length < 2) {
			this.error(", the correct command arguments are `changerole {hexcode} {role name}`");
			return;
		}

		let hexcode = this.msg.args[0];
		let roleName = this.msg.args.splice(1).join(' ');

		const user = await this.db.User.findById(this.msg.author.id);
		console.log(user);

		let result = await this.db.User.updateOne(
			{ _id: this.msg.author.id },
			{
				role: {
					_id: "test",
					color: hexcode,
					name: roleName
				}
			},
			{ upsert: true }
		);
		console.log(result);

		this.reply(", you changed your roles!");

	}

});
