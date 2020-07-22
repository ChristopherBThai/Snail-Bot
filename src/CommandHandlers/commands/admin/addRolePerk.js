const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["addroleperk"],

	emoji: '⚙️',

	mods: true,

	execute: async function() {
		//disable for now
		return;

		if (this.msg.args.length < 2) {
			this.error(", wrong arguments");
			return;
		}

		let id = this.msg.args[0];
		// TODO check id by looking at mentions
		let months = parseInt(this.msg.args[1]);
		if (!months) {
			this.error(", wrong arguments");
			return;
		}

		await this.db.User.updateOne(
			{ _id: id },
			{
				roleBenefit: {
					months: months,
					started: new Date()
				}
			},
			{ upsert: true }
		);
	}

});
