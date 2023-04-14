const { isStaff } = require("../utils/global");
const cooldowns = {};

module.exports = class CommandInterface {
	constructor(args) {
		this.alias = args.alias;
		this.emoji = args.emoji;
		this.executeCommand = args.execute;
		this.auth = args.auth;
		this.description = args.description;
		this.examples = args.examples;
		this.usage = args.usage;
		this.cooldown = args.cooldown;
		this.group = args.group;
	}

	async execute(params) {
		await params.msg.channel.sendTyping();

		if (this.auth?.(params.msg.member) ?? true) {
			// Staff are not bound by the chains of cooldowns >:)
			if (!isStaff(params.msg.member)) {
				const commandName = this.alias[0];
				const key = `${params.msg.author.id}_${commandName}`;

				const cooldown = cooldowns[key] ?? { lastused: new Date(0), warned: false };
				const now = Date.now();

				// Difference in milliseconds
				const diff = now - cooldown.lastused;

				// If still on cooldown
				if (diff < (this.cooldown ?? 0)) {
					// If not already warned, warn, otherwise ignore
					if (cooldown.warned) return;

					cooldowns[key].warned = true;
					await params.error(`! Slow down and try the command again **<t:${((this.cooldown - diff + now) / 1000).toFixed(0)}:R>**`);	
					return;				
				} else {
					cooldowns[key] = { lastused: now, warned: false };
				}
			}

			await this.executeCommand.bind(params)();
		} else {
			await params.error(', you do not have permission to use this command!');
		}
	}
};
