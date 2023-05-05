module.exports = class Setup {
    constructor(bot) {
        this.bot = bot;
        this.events = {
            "ready": this.ready
        }
    }

    // Will be run everytime the bot reinitializes its websocket connection with discord (including on startup)
    async ready() {
        console.log('Bot is ready!');
    }
};


