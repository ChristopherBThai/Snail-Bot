const Command = require('../Command.js');

const PREVIEW_LEN = 180;
const Q_TEXT_LEN = 100;
const MAX_VARIANTS_PER_GROUP = 6;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

module.exports = new Command({
    alias: ['askdebug', 'kbdebug', 'kbsearch'],

    group: 'Staff',

    auth: require('../../utils/permissions.js').hasAdminPerms,

    cooldown: 3000,

    usage: 'snail askdebug [N] {question}',

    description:
        'Show grouped Qdrant retrieval results for a question (no chat call). ' +
        'Hits are deduped by entry and ranked by the top-scoring variant; ' +
        'every matched Q variant is listed under its entry with its own score. ' +
        'Optional `N` (1-20) caps the number of entries shown (default: 10). ' +
        'Returns results regardless of score threshold so you can see borderline matches.',

    examples: ['snail askdebug what are gems?', 'snail askdebug 5 how do I appeal?'],

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

        let args = [...this.message.args];
        let limit = DEFAULT_LIMIT;
        const maybeLimit = parseInt(args[0], 10);
        if (!Number.isNaN(maybeLimit) && maybeLimit > 0 && maybeLimit <= MAX_LIMIT) {
            limit = maybeLimit;
            args = args.slice(1);
        }

        const question = args.join(' ').trim();
        if (!question) {
            await this.error('please provide a question! Example: `snail askdebug what are gems?`');
            return;
        }
        if (question.length > 500) {
            await this.error('that question is too long! Please keep it under 500 characters.');
            return;
        }

        let result;
        try {
            result = await KB.debugSearch(question, { limit, includeBelowThreshold: true });
        } catch (err) {
            console.error('[KB] askdebug failed:', err.message);
            await this.error(`debug search failed: \`${err.message}\``);
            return;
        }

        const { hits, groups, threshold } = result;

        if (!hits.length || !groups.length) {
            await this.send({
                embed: {
                    title: 'KB Debug — no results',
                    description:
                        `**Question:** ${question}\n\nQdrant returned ${hits.length} points and ${groups.length} tag matches. ` +
                        'The collection may be empty — run `snail kb reindex`.',
                    color: this.config.color.orange,
                },
            });
            return;
        }

        const ranked = groups.slice(0, limit);

        const fields = ranked.map((group, i) => {
            const passes = group.topScore >= threshold ? '✅' : '⚠️';
            const shown = group.hits.slice(0, MAX_VARIANTS_PER_GROUP);
            const truncated = group.hits.length - shown.length;
            const matched = shown
                .map((hit) => {
                    const kind = hit.payload?.kind || 'unknown';
                    if (kind === 'tag_question') {
                        const q = (hit.payload?.question || '—').slice(0, Q_TEXT_LEN);
                        const tail = (hit.payload?.question || '').length > Q_TEXT_LEN ? '…' : '';
                        return `\`${hit.score.toFixed(4)}\` (${kind}) ${q}${tail}`;
                    }
                    return `\`${hit.score.toFixed(4)}\` (${kind}) tag data passage`;
                })
                .join('\n');
            const more = truncated > 0 ? `\n*+${truncated} more match${truncated > 1 ? 'es' : ''}*` : '';
            const kinds = group.matchedKinds.join(', ') || '—';
            const matchedQuestions = group.matchedQuestions.map(
                (q) => `- ${q.slice(0, Q_TEXT_LEN)}${q.length > Q_TEXT_LEN ? '…' : ''}`
            );
            const questions = matchedQuestions.length ? matchedQuestions.join('\n') : '—';
            const preview = group.dataPreview.slice(0, PREVIEW_LEN);
            const ellipsis = group.dataPreview.length > PREVIEW_LEN ? '…' : '';

            return {
                name: `${i + 1}. ${passes} \`${group.tagId}\` — top score ${group.topScore.toFixed(4)}`,
                value:
                    `**Matched kinds:** ${kinds}\n` +
                    `**Matched hits:**\n${matched}${more}\n` +
                    `**Generated-question matches:**\n${questions}\n` +
                    `**Tag data preview:** ${preview}${ellipsis}`,
            };
        });

        const passingGroups = ranked.filter((group) => group.topScore >= threshold).length;

        const embed = {
            title: 'KB Debug Results',
            description:
                `**Question:** ${question}\n` +
                `**Threshold:** ${threshold} — **${passingGroups}/${ranked.length}** tags would pass\n` +
                `**Raw hits fetched:** ${hits.length} (${groups.length} unique tags)`,
            color: this.config.embedcolor,
            fields: fields.slice(0, 10),
            footer: {
                text:
                    ranked.length > 10
                        ? `Showing top 10 of ${ranked.length} unique tags (Discord embed limit)`
                        : `${ranked.length} unique tags`,
            },
        };

        await this.send({ embed });
    },
});
