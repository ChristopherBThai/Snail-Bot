module.exports = class CommandInterface {
	constructor(args) {
		this.alias = args.alias;
		this.emoji = args.emoji;
		this.executeCommand = args.execute;
		this.mods = args.mods;
		this.helpers = args.helpers;
	}

	async execute(params) {
		await params.msg.channel.sendTyping();
		let valid = !this.mods && !this.helpers;
		if (
			this.mods &&
			params.global.hasRoles(params.msg.member, params.config.roles.mods)
		) {
			valid = true;
		}
		if (
			this.helpers &&
			params.global.hasRoles(params.msg.member, params.config.roles.helpers)
		) {
			valid = true;
		}

		if (valid) {
			await this.executeCommand.bind(params)();
		} else {
			await params.error(', you do not have permission to use this command!');
		}
	}
};
