const { ApplicationCommandTypes } = require('eris/lib/Constants');
const Command = require('../InteractionCommand');
const { isOwner } = require('../../util');

module.exports = new Command({
    type: ApplicationCommandTypes.USER,
    name: 'Send User Data',
    definition: {
        type: ApplicationCommandTypes.USER,
        name: 'Send User Data'
    },
    auth: (ctx) => isOwner(ctx.member ?? ctx.user),
    execute: async function (ctx) {
        const user = ctx.target;
        if (!user?.id) return await ctx.error('could not resolve a target user!');

        await ctx.acknowledge(64);

        const tables = await getMySQLTables(ctx.bot.mysql);
        const data = await tables.user.getData('id', [user.id]);
        const file = {
            name: `user-data-${user.id}.txt`,
            file: Buffer.from(data, 'utf-8')
        };

        await ctx.sendEphemeral(`Data request for \`${user.id}\``, file);
    }
});

async function getMySQLTables(query) {
    const constraints = await query('SELECT * FROM `INFORMATION_SCHEMA`.`KEY_COLUMN_USAGE` WHERE `TABLE_SCHEMA` = SCHEMA() AND `REFERENCED_TABLE_NAME` IS NOT NULL;');
    const tables = {};

    for (const constraint of constraints) {
        if (constraint.CONSTRAINT_SCHEMA != 'owo') continue;

        const table = constraint.TABLE_NAME;
        const referencedTable = constraint.REFERENCED_TABLE_NAME;
        tables[table] ??= new MySQLTable(query, tables, table);
        tables[referencedTable] ??= new MySQLTable(query, tables, referencedTable);
        tables[referencedTable].addRelation(constraint);
    }

    return tables;
}

class MySQLTable {
    constructor(query, tables, name) {
        this.query = query;
        this.tables = tables;
        this.name = name;
        this.complete = false;
        this.relationships = {};
        this.rows = [];
    }

    addRelation({ TABLE_NAME, COLUMN_NAME, REFERENCED_COLUMN_NAME } = {}) {
        this.relationships[TABLE_NAME] = {
            column: REFERENCED_COLUMN_NAME,
            referencedColumn: COLUMN_NAME
        };
    }

    async getData(column, values) {
        if (this.complete || values.length == 0) return '';

        const result = await this.query(`SELECT * FROM \`${this.name}\` WHERE ${column} in (?)`, [values]);
        if (!result.length) return '';

        let data = `${this.name}\n${JSON.stringify(result)}\n\n`;
        this.rows.push(...result);
        this.complete = true;

        for (const [tableName, { column, referencedColumn }] of Object.entries(this.relationships)) {
            const table = this.tables[tableName];
            if (!table) continue;

            const referencedValues = this.rows.map(row => row[column]).filter(Boolean);
            data += await table.getData(referencedColumn, referencedValues);
        }

        return data;
    }
}
