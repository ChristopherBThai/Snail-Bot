const Command = require('../Command.js');

module.exports = new Command({
    alias: ['ask'],

    group: 'Util',

    cooldown: 5000,

    usage: 'snail ask {question}',

    description: 'Ask a question about OwO bot and get an answer from the knowledge base.',

    examples: ['snail ask what are gems?', 'snail ask how do I get cowoncy?'],

    execute: async function () {
        const KB = this.bot.modules['knowledgebase'];

        if (!KB) {
            await this.error('the Knowledge Base module is not loaded.');
            return;
        }

        if (!KB.enabled) {
            await this.error('the Knowledge Base module is currently disabled.');
            return;
        }

        const question = this.message.args.join(' ').trim();
        if (!question) {
            await this.error('please provide a question! Example: `snail ask what are gems?`');
            return;
        }

        if (question.length > 500) {
            await this.error('that question is too long! Please keep it under 500 characters.');
            return;
        }

        try {
            const result = await KB.ask(question);
            await KB.sendAnswer(this.message, result);
        } catch (err) {
            console.error('[KB] ask command failed:', err.message);
            await this.error('something went wrong while looking that up.');
        }
    },
});
