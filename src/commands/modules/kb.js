const Command = require('../Command.js');

module.exports = new Command({
    alias: ['kb'],

    group: 'Module',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail kb {...arguments}',

    description:
        '- `snail kb status`\n - Show knowledge base sync status and collection info\n' +
        '- `snail kb reindex`\n - Sync `kb.json` to Qdrant (only changed entries are re-embedded)\n' +
        '- `snail kb reindex dry`\n - Show what a reindex would do without making changes\n' +
        '- `snail kb model {modelSlug}`\n - Set the chat model (OpenRouter slug)\n',

    examples: [
        'snail kb status',
        'snail kb reindex',
        'snail kb reindex dry',
        'snail kb model anthropic/claude-haiku-4.5',
    ],

    execute: async function () {
        const KB = this.bot.modules['knowledgebase'];
        if (!KB) {
            await this.error('the Knowledge Base module is not loaded.');
            return;
        }

        const subcommand = this.message.args.shift()?.toLowerCase();

        switch (subcommand) {
            case 'status': {
                let pointCount = null;
                try {
                    if (!KB.qdrant) await KB.initQdrant();
                    pointCount = await KB.qdrant.count(KB.collection);
                } catch (err) {
                    pointCount = `error: ${err.message}`;
                }

                let last;
                if (KB.syncing) last = 'in progress';
                else if (KB.lastSync) last = `<t:${Math.floor(KB.lastSync.getTime() / 1000)}:R>`;
                else last = 'never';
                const lastSummary = KB.lastSyncSummary
                    ? `\n - added: ${KB.lastSyncSummary.added}` +
                      `\n - vector updates: ${KB.lastSyncSummary.vectorUpdated}` +
                      `\n - payload updates: ${KB.lastSyncSummary.metaUpdated}` +
                      `\n - deleted: ${KB.lastSyncSummary.deleted}` +
                      `\n - unchanged: ${KB.lastSyncSummary.unchanged}`
                    : '';

                const embed = {
                    title: 'Knowledge Base Status',
                    color: this.config.embedcolor,
                    description:
                        `**Enabled:** ${KB.enabled}\n` +
                        `**Collection:** \`${KB.collection}\`\n` +
                        `**Points in Qdrant:** ${pointCount}\n` +
                        `**Chat Model:** \`${KB.chatModel}\`\n` +
                        `**Embedding Model:** \`${KB.embeddingModel}\`\n` +
                        `**Last Sync:** ${last}${lastSummary}`,
                };

                await this.send({ embed });
                break;
            }
            case 'reindex': {
                const dry = this.message.args[0]?.toLowerCase() === 'dry';

                if (KB.syncing) {
                    await this.error('a sync is already in progress!');
                    return;
                }

                const status = await this.send(`🐌 **|** ${dry ? 'Computing diff' : 'Syncing'}...`);

                try {
                    const summary = await KB.sync({ dryRun: dry });
                    const embed = {
                        title: dry ? 'Reindex (dry run)' : 'Reindex Complete',
                        color: this.config.embedcolor,
                        description:
                            `**Added:** ${summary.added}\n` +
                            `**Vector updates:** ${summary.vectorUpdated}\n` +
                            `**Payload updates:** ${summary.metaUpdated}\n` +
                            `**Deleted:** ${summary.deleted}\n` +
                            `**Unchanged:** ${summary.unchanged}\n` +
                            `**Entries:** ${summary.totalEntries}\n` +
                            `**Points:** ${summary.totalPoints} ` +
                            `(${summary.totalVariants} q + ${summary.totalAnswers} a)`,
                    };
                    await status.edit({ content: '', embed });
                } catch (err) {
                    console.error('[KB] reindex failed:', err);
                    await status.edit({ content: `🚫 **|** Reindex failed: \`${err.message}\`` });
                }
                break;
            }
            case 'model': {
                const model = this.message.args.shift();
                if (!model) {
                    await this.error(
                        'please provide a model slug! Example: `snail kb model anthropic/claude-haiku-4.5`'
                    );
                    return;
                }
                await KB.setChatModel(model);
                await this.send(`I have set the chat model to \`${model}\`!`);
                break;
            }
            default: {
                await this.error(
                    'that is not a valid subcommand! Use `snail kb [status|reindex|model] {...arguments}`'
                );
                break;
            }
        }
    },
});
