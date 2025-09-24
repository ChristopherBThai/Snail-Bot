const UserInteraction = require('./UserInteraction.js');
const { parseEmoji, getUniqueUsername, getUid, validSnowflake, fetchUser } = require('../utils/global.js');
const { ephemeralInteractionResponse, owoCreateMessage } = require('../utils/sender');
const query = require('../databases/mysql/mysql.js');

module.exports = new UserInteraction({
    name: 'Send User Data',

    ownerOnly: true,

    execute: async function () {
        let user = this.target;

        const sql =
            'SELECT * FROM `INFORMATION_SCHEMA`.`KEY_COLUMN_USAGE` WHERE `TABLE_SCHEMA` = SCHEMA() AND `REFERENCED_TABLE_NAME` IS NOT NULL;';
        const constraints = await query(sql);
        await this.interaction.acknowledge(5);
        const tables = {};
        constraints.forEach((constraint) => {
            if (constraint.CONSTRAINT_SCHEMA != 'owo') {
                return;
            }
            const table = constraint.TABLE_NAME;
            const rTable = constraint.REFERENCED_TABLE_NAME;
            if (!tables[table]) {
                tables[table] = new MySQLTable(tables, table);
            }
            if (!tables[rTable]) {
                tables[rTable] = new MySQLTable(tables, rTable);
            }
            tables[rTable].addRelation(constraint);
        });

        console.log(`Fetching MySQL user data for ${user.id}`);
        const data = await tables['user'].getData('id', [user.id]);
        console.log(`Finished fetching MySQL user data with ${data.length} bytes`);
        const file = {
            name: 'data.txt',
            file: Buffer.from(data, 'utf-8'),
        };
        await this.interaction.createMessage(`Data request for \`${user.id}\``, file);
    },
});

class MySQLTable {
    constructor(tables, name) {
        this.name = name;
        this.tables = tables;
        this.complete = false;
        this.relationships = {};
        this.rows = [];
    }

    addRelation({ TABLE_NAME, COLUMN_NAME, REFERENCED_COLUMN_NAME } = {}) {
        this.relationships[TABLE_NAME] = {
            column: REFERENCED_COLUMN_NAME,
            referencedColumn: COLUMN_NAME,
        };
    }

    async getData(column, values) {
        let data = '';
        if (this.complete || values.length === 0) return '';

        const sql = `SELECT * FROM \`${this.name}\` WHERE ${column} in (?)`;
        console.log(`Querying ${this.name} with column ${column} (${values.length})`);
        const result = await query(sql, [values]);
        if (!result.length) return '';
        data += `${this.name}\n${JSON.stringify(result)}\n\n`;
        result.forEach((row) => {
            this.rows.push(row);
        });
        this.complete = true;

        for (let tableName in this.relationships) {
            const refTable = this.tables[tableName];
            if (!refTable) {
                console.error(`No reference table found for: ${tableName}`);
                break;
            }
            const { column, referencedColumn } = this.relationships[tableName];
            const refValues = [];
            for (let i in this.rows) {
                const row = this.rows[i];
                const value = row[column];
                if (!value) {
                    console.error(`No value for ${this.name} - ${column}`);
                    break;
                } else {
                    refValues.push(value);
                }
            }
            data += await refTable.getData(referencedColumn, refValues);
        }

        return data;
    }

    toJSON() {
        return {
            name: this.name,
            complete: this.complete,
            relationships: this.relationships,
        };
    }
}
