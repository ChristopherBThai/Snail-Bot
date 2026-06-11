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

        const { hits, threshold } = result;

        if (!hits.length) {
            await this.send({
                embed: {
                    title: 'KB Debug — no results',
                    description:
                        `**Question:** ${question}\n\nQdrant returned 0 points. ` +
                        'The collection may be empty — run `snail kb reindex`.',
                    color: this.config.color.orange,
                },
            });
            return;
        }

        // Group hits by entry (a_hash). Qdrant returns hits sorted by score desc,
        // so the first hit per group is the top-scoring variant for that entry.
        const groups = new Map();
        for (const hit of hits) {
            const key = hit.payload?.a_hash || hit.payload?.a;
            if (!key) continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(hit);
        }

        const ranked = Array.from(groups.values()).slice(0, limit);

        const fields = ranked.map((groupHits, i) => {
            const top = groupHits[0];
            const p = top.payload || {};
            const passes = top.score >= threshold ? '✅' : '⚠️';
            const cats = Array.isArray(p.category) ? p.category.join(', ') : p.category || '—';
            const preview = (p.a || '').replace(/\s+/g, ' ').slice(0, PREVIEW_LEN);
            const ellipsis = (p.a || '').length > PREVIEW_LEN ? '…' : '';
            const sourceLine = p.source ? `\n**Source:** ${p.source}` : '';

            const shown = groupHits.slice(0, MAX_VARIANTS_PER_GROUP);
            const truncated = groupHits.length - shown.length;
            const matchedQs = shown
                .map((h) => {
                    const kind = h.payload?.kind === 'a' ? '(a)' : '(q)';
                    if (h.payload?.kind === 'a') {
                        return `\`${h.score.toFixed(4)}\` ${kind} answer passage`;
                    }
                    const q = (h.payload?.q || '—').slice(0, Q_TEXT_LEN);
                    const tail = (h.payload?.q || '').length > Q_TEXT_LEN ? '…' : '';
                    return `\`${h.score.toFixed(4)}\` ${kind} ${q}${tail}`;
                })
                .join('\n');
            const more = truncated > 0 ? `\n*+${truncated} more match${truncated > 1 ? 'es' : ''}*` : '';

            const matchLabel = `${groupHits.length} match${groupHits.length > 1 ? 'es' : ''}`;

            return {
                name: `${i + 1}. ${passes} top score ${top.score.toFixed(4)} — ${matchLabel}`,
                value:
                    `**Matched:**\n${matchedQs}${more}\n` +
                    `**A preview:** ${preview}${ellipsis}\n` +
                    `**Categories:** ${cats}${sourceLine}`,
            };
        });

        const passingGroups = ranked.filter((g) => g[0].score >= threshold).length;

        const embed = {
            title: 'KB Debug Results',
            description:
                `**Question:** ${question}\n` +
                `**Threshold:** ${threshold} — **${passingGroups}/${ranked.length}** entries would pass\n` +
                `**Raw hits fetched:** ${hits.length} (${groups.size} unique entries)`,
            color: this.config.embedcolor,
            fields: fields.slice(0, 10),
            footer: {
                text:
                    ranked.length > 10
                        ? `Showing top 10 of ${ranked.length} unique entries (Discord embed limit)`
                        : `${ranked.length} unique entries`,
            },
        };

        await this.send({ embed });
    },
});
