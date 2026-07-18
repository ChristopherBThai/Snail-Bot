const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const removedFiles = [
    'src/databases/mongodb/schemas/KnowledgeSchema.js',
    'src/data/kb.json',
    'scripts/migrate-kb-to-mongo.js',
    'src/data/kb.import-log.json',
    'src/utils/kbPanel.js',
    'src/utils/kbInteractions.js',
    'src/utils/kbSessions.js',
    'src/utils/componentsV2.js',
];

for (const file of removedFiles) {
    assert.ok(!fs.existsSync(path.join(root, file)), `${file} should be removed from the tag-backed KB path`);
}

const sourceChecks = [
    {
        file: 'src/modules/KnowledgeBase.js',
        forbidden: [
            'this.bot.snail_db.Knowledge',
            'getEntry(',
            'createEntry(',
            'updateEntry(',
            'deleteEntry(',
            'syncEntry(',
            'buildDesiredPoints(',
            'entryFilter(',
            'entry_id',
        ],
    },
    {
        file: 'src/commands/modules/kb.js',
        forbidden: ['kbPanel', 'kbInteractions', 'kbSessions', 'createEntry(', 'snail kb add`\n'],
    },
    {
        file: 'src/utils/kb.js',
        forbidden: ["'category'", "'entry_id'"],
    },
];

for (const check of sourceChecks) {
    const source = fs.readFileSync(path.join(root, check.file), 'utf8');
    for (const needle of check.forbidden) {
        assert.ok(!source.includes(needle), `${check.file} should not contain legacy KB reference: ${needle}`);
    }
}

console.log('Legacy Knowledge schema, seed, migration, and editor artifacts are removed from runtime paths.');
