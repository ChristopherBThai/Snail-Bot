module.exports = class CommandInterface {

	constructor (args) {
		this.alias = args.alias;
		this.emoji = args.emoji;
		this.executeCommand = args.execute;
		this.mods = args.mods;
	}

	async execute(params) {
		await params.msg.channel.sendTyping();
		if (this.mods && !params.global.hasRoles(params.msg.member, params.config.roles.mods)) {
			await params.error(", you do not haver permission to use this command!");
		} else {
			await this.executeCommand.bind(params)();
		}
	}

}
