const Command = require('../Command.js');

const FIND_PREVIEW_LEN = 220;
const FIND_QUESTION_LEN = 120;

module.exports = new Command({
    alias: ['kb'],

    group: 'Module',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail kb {...arguments}',

    description:
        '- `snail kb status`\n - Show tag-backed knowledge base sync status and collection info\n' +
        '- `snail kb reindex`\n - Sync Mongo tags to Qdrant (only changed tag points are re-embedded)\n' +
        '- `snail kb reindex dry`\n - Show what a reindex would do without making changes\n' +
        '- `snail kb reset confirm`\n - Destructively recreate the Qdrant collection, then sync Mongo tags. Remote resets require backup through `ssh hub.corg.network` first.\n' +
        '- `snail kb find {query}`\n - Search matching tags for manager/debug review\n' +
        '- `snail kb model {modelSlug}`\n - Set the chat model (OpenRouter slug)\n',

    examples: [
        'snail kb status',
        'snail kb reindex',
        'snail kb reindex dry',
        'snail kb reset confirm',
        'snail kb find how do gems expire',
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
            case 'status':
                return showStatus.call(this, KB);
            case 'reindex':
                return runReindex.call(this, KB);
            case 'reset':
                return runReset.call(this, KB);
            case 'find':
                return runFind.call(this, KB);
            case 'add':
                await this.error(
                    '`snail kb add` has been removed. Add support content with `snail tag add {name} {data}`.'
                );
                return;
            case 'model':
                return setModel.call(this, KB);
            default:
                await this.error(
                    'that is not a valid subcommand! Use `snail kb [status|reindex|reset|find|model] {...arguments}`'
                );
        }
    },
});

async function showStatus(KB) {
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
}

async function runReindex(KB) {
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
                `**Tags:** ${summary.totalTags}\n` +
                `**Points:** ${summary.totalPoints} ` +
                `(${summary.totalQuestions} generated questions + ${summary.totalAnswers} tag data points)`,
        };
        await status.edit({ content: '', embed });
    } catch (err) {
        console.error('[KB] reindex failed:', err);
        await status.edit({ content: `🚫 **|** Reindex failed: \`${err.message}\`` });
    }
}

async function runReset(KB) {
    const confirm = this.message.args[0]?.toLowerCase() === 'confirm';
    const backupReminder =
        'Remote reset requires backup evidence first: run/record backup through `ssh hub.corg.network` before using this command against remote Qdrant.';

    if (!confirm) {
        await this.error(
            `this is destructive: it recreates Qdrant collection \`${KB.collection}\`. ` +
                `${backupReminder} To continue, run \`snail kb reset confirm\`.`
        );
        return;
    }

    if (KB.syncing) {
        await this.error('a sync is already in progress!');
        return;
    }

    const status = await this.send(`⚠️ **|** Resetting Qdrant collection \`${KB.collection}\` and syncing tags...`);

    try {
        const summary = await KB.resetQdrantAndSync();
        const embed = {
            title: 'Qdrant Reset Complete',
            color: this.config.embedcolor,
            description:
                `**Collection:** \`${summary.collection || KB.collection}\`\n` +
                `**Tags:** ${summary.totalTags}\n` +
                `**Points:** ${summary.totalPoints} ` +
                `(${summary.totalQuestions} generated questions + ${summary.totalAnswers} tag data points)\n\n` +
                `**Backup reminder:** ${backupReminder}`,
        };
        await status.edit({ content: '', embed });
    } catch (err) {
        console.error('[KB] reset failed:', err);
        await status.edit({ content: `🚫 **|** Reset failed: \`${err.message}\`` });
    }
}

async function runFind(KB) {
    const query = this.message.args.join(' ').trim();
    if (!query) {
        await this.error('please provide a query! Example: `snail kb find how do gems work`');
        return;
    }
    if (query.length > 500) {
        await this.error('that is too long! Keep it under 500 characters.');
        return;
    }

    let groups;
    try {
        groups = await KB.findSimilar(query, { limit: 5 });
    } catch (err) {
        console.error('[KB] findSimilar failed:', err);
        await this.error(`search failed: \`${err.message}\``);
        return;
    }

    if (!groups.length) {
        await this.send({
            embed: {
                title: 'KB Tag Find — no results',
                description: `No matching tags found for: ${query}`,
                color: this.config.color.orange,
            },
        });
        return;
    }

    const fields = groups.slice(0, 5).map((group, index) => {
        const kinds = group.matchedKinds?.join(', ') || '—';
        const matchedQuestions = (group.matchedQuestions || []).map(
            (q) => `- ${q.slice(0, FIND_QUESTION_LEN)}${q.length > FIND_QUESTION_LEN ? '…' : ''}`
        );
        const questions = matchedQuestions.length ? matchedQuestions.join('\n') : '—';
        const preview = (group.dataPreview || '').slice(0, FIND_PREVIEW_LEN);
        const ellipsis = (group.dataPreview || '').length > FIND_PREVIEW_LEN ? '…' : '';
        return {
            name: `${index + 1}. \`${group.tagId}\` — top score ${group.topScore.toFixed(4)}`,
            value:
                `**Matched kinds:** ${kinds}\n` +
                `**Generated-question matches:**\n${questions}\n` +
                `**Tag data preview:** ${preview}${ellipsis}\n` +
                `**Manage:** \`snail tag edit ${group.tagId} {data}\` or \`snail tag delete ${group.tagId}\``,
        };
    });

    await this.send({
        embed: {
            title: 'KB Tag Find Results',
            description:
                `**Query:** ${query}\n` +
                'Results are tag-backed. Add or change support content with `snail tag add/edit/delete`.',
            color: this.config.embedcolor,
            fields,
        },
    });
}

async function setModel(KB) {
    const model = this.message.args.shift();
    if (!model) {
        await this.error('please provide a model slug! Example: `snail kb model anthropic/claude-haiku-4.5`');
        return;
    }
    await KB.setChatModel(model);
    await this.send(`I have set the chat model to \`${model}\`!`);
}
