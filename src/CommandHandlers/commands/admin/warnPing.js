const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["warnping"],

	emoji: '📢',

	mods: true,
	helpers: true,

	execute: async function() {

		let user = await this.db.User.findById(this.msg.member.id);
		if (this.msg.args.length) {
			let switchValue; // this value will be inverted because adding new fields to the model with default values is awkward so I needed "on" to be falsy

			if (this.msg.args.length > 1) {
				if ('on' == this.msg.args[1].toLowerCase()) {
					switchValue = true;
				}
				else if ('off' == this.msg.args[1].toLowerCase()) {
					switchValue = false;
				}
				else {
					await this.error(", if you know a third state for a switch than on / off, please let me know...");
					return;
				}
				// invert since the check is true = ignore instead of true = warn
				switchValue = !switchValue;
			}
			if ('dnd' == this.msg.args[0].toLowerCase() || 'offline' == this.msg.args[0].toLowerCase()) {
				user.ignorePingOffline = switchValue ? switchValue : !user.ignorePingOffline;
			}
			else if ('spam' == this.msg.args[0].toLowerCase()) {
				user.ignorePingSpam = switchValue ? switchValue : !user.ignorePingSpam;
			}
			else if ('off' == this.msg.args[0].toLowerCase()) {
				user.ignorePingOffline = true;
				user.ignorePingSpam = true;
			}
			else if ('on' == this.msg.args[0].toLowerCase()) {
				user.ignorePingOffline = false;
				user.ignorePingSpam = false;
			}
			else {
				await this.error(", that's not a type of ping I support at this time!");
				return;
			}
		}

		await user.save();
		
		await this.reply(
			`'s ping warning configuration:\r\n` +
			'```' +
			`Warn for pings while DND / Offline: ${!user.ignorePingOffline ? 'On' : 'Off'}\r\n` +
			`Warn for pings in spam channels: ${!user.ignorePingSpam ? 'On' : 'Off'}` +
			'```'
		);
		return;
	}

});
