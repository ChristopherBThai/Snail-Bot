module.exports = class CommandInterface {

	constructor (args) {
		this.alias = args.alias;
		this.emoji = args.emoji;
		this.executeCommand = args.execute;
	}

	async execute(params) {
		await this.executeCommand.bind(params)();
	}

}
