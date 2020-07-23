const requireDir = require('require-dir');
const dir = requireDir('./');
const handlers = [];

class EventHandler{
	constructor(bot){
		let filename = __filename.slice(__dirname.length + 1, -3);
		for (let listener in dir) {
			if (listener!=filename) {
				const handler = new dir[listener](bot);
				bot.on(listener, handler.handle.bind(handler));
				handlers.push(handler);
			}
		}
	}
}

module.exports = EventHandler;
