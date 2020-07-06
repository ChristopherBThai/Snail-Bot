const requireDir = require('require-dir');
const dir = requireDir('./');

class EventHandler{
	constructor(bot){
		let filename = __filename.slice(__dirname.length + 1, -3);
		for(let listener in dir){
			if(listener!=filename)
				bot.on(listener,dir[listener].handle.bind(bot));
		}
	}
}

module.exports = EventHandler;
