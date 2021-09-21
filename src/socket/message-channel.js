const messageQueue = {};

module.exports = class MessageChannel {
	constructor (bot, socket) {
		this.bot = bot;
		this.socket = socket;
	}

	handle (payload) {
		const { channelId } = payload;
		if (!messageQueue[channelId]) {
			messageQueue[channelId] = {
				timer: null,
				queue: []
			};
		}

		const channel = messageQueue[channelId];
		channel.queue.push(payload);
		if (!channel.timer) {
			channel.timer = setInterval(() => {
				this.sendMsg(channel);
			}, 1100);
		}
	}

	sendMsg (channel) {
		const payload = channel.queue.shift();
		if (!payload) {
			clearInterval(channel.timer);
			channel.timer = null;
			return;
		}

		const { channelId, contents } = payload;
		console.log(channelId + " has queue: " + channel.queue.length);
		this.bot.createMessage(channelId, contents);
	}
}
