import { ApplicationCommandType, ApplicationIntegrationType, InteractionContextType } from 'discord-api-types/v10';
import { hasOwnerAccess } from '../discord/auth.js';
import { getTargetUser } from '../discord/interactions.js';

const SEND_USER_DATA_COMMAND_DEFINITION = {
    type: ApplicationCommandType.User,
    name: 'Send User Data',
    integrationTypes: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
    contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
};

/** @type {import('../packages.js').PackageSetup} */
export default function setup({ config, logging, services, unavailable }) {
    const log = logging.createLogger('sendUserData');
    const missing = [];
    const mysql = services.owo.mysql;

    if (!config.users?.owner) missing.push('users.owner (config)');
    missing.push(...(unavailable.owo.mysql ?? []));
    return {
        name: 'Send User Data Command',
        missing,
        commands: [
            {
                definition: SEND_USER_DATA_COMMAND_DEFINITION,
                global: true,
                authorize: hasOwnerAccess,
                async handle({ interaction, respond, defer, editResponse }) {
                    const user = getTargetUser(interaction);

                    if (!user) {
                        await respond('Could not resolve that user.', { ephemeral: true });
                        return;
                    }

                    await defer({ ephemeral: true });

                    log.info('Exporting OwO user data', { userId: user.id });
                    const { data, rowCount, tableCount } = await exportUserData(mysql, user.id);
                    const bytes = Buffer.byteLength(data);
                    const timestamp = new Date().toISOString().replaceAll(':', '-');
                    const name = `user-data-${user.id}-${timestamp}.txt`;

                    log.info('Exported OwO user data', {
                        userId: user.id,
                        bytes,
                        rows: rowCount,
                        tables: tableCount,
                    });

                    if (!bytes) {
                        await editResponse('No data found for that user.');
                        return;
                    }

                    if (bytes > interaction.attachmentSizeLimit) {
                        await editResponse('The exported user data is too large to send through Discord.');
                        return;
                    }

                    await editResponse({
                        content: `Data request for \`${user.id}\`.`,
                        files: [
                            {
                                name,
                                blob: new Blob([data], { type: 'text/plain' }),
                            },
                        ],
                    });
                },
            },
        ],
    };
}

async function exportUserData(mysql, userId) {
    const [constraints] = await mysql.query(`
        SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = SCHEMA() AND REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY REFERENCED_TABLE_NAME, TABLE_NAME, COLUMN_NAME
    `);
    const relationships = new Map();

    for (const constraint of constraints) {
        const parent = constraint.REFERENCED_TABLE_NAME;
        const relations = relationships.get(parent) ?? [];

        relations.push({
            table: constraint.TABLE_NAME,
            column: constraint.COLUMN_NAME,
            parentColumn: constraint.REFERENCED_COLUMN_NAME,
        });
        relationships.set(parent, relations);
    }

    const pending = [{ table: 'user', column: 'id', values: [userId] }];
    const queried = new Map();
    const rowsByTable = new Map();
    const seenRows = new Map();

    while (pending.length) {
        const { table, column, values } = pending.shift();

        const queryKey = `${table}.${column}`;
        const queriedValues = queried.get(queryKey) ?? new Set();
        const newValues = [...new Set(values.filter((value) => value !== null && value !== undefined))].filter(
            (value) => !queriedValues.has(String(value)),
        );

        if (!newValues.length) continue;
        for (const value of newValues) queriedValues.add(String(value));
        queried.set(queryKey, queriedValues);

        const [rows] = await mysql.query(`SELECT * FROM \`${table}\` WHERE \`${column}\` IN (?)`, [newValues]);
        if (!rows.length) continue;

        const tableRows = rowsByTable.get(table) ?? [];
        const tableSeenRows = seenRows.get(table) ?? new Set();
        const addedRows = [];

        for (const row of rows) {
            const key = JSON.stringify(row);
            if (tableSeenRows.has(key)) continue;

            tableSeenRows.add(key);
            tableRows.push(row);
            addedRows.push(row);
        }

        rowsByTable.set(table, tableRows);
        seenRows.set(table, tableSeenRows);

        for (const relation of relationships.get(table) ?? []) {
            pending.push({
                table: relation.table,
                column: relation.column,
                values: addedRows.map((row) => row[relation.parentColumn]),
            });
        }
    }

    let data = '';
    let rowCount = 0;

    for (const [table, rows] of rowsByTable) {
        data += `${table}\n${JSON.stringify(rows)}\n\n`;
        rowCount += rows.length;
    }

    return {
        data,
        rowCount,
        tableCount: rowsByTable.size,
    };
}
