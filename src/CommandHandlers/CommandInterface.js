module.exports = class CommandInterface {
	constructor(args) {
		this.alias = args.alias;
		this.emoji = args.emoji;
		this.executeCommand = args.execute;
		this.auth = args.auth;
		this.description = args.description;
		this.examples = args.examples;
		this.usage = args.usage;
	}

	async execute(params) {
		await params.msg.channel.sendTyping();
		
		if (this.auth?.(params.msg.member) ?? true) {
			await this.executeCommand.bind(params)();
		} else {
			await params.error(', you do not have permission to use this command!');
		}
	}
};
