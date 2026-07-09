import { expect, test } from 'vitest';
import { buildModulePanel, ModuleRuntimePageID } from '../src/commands/module.js';
import { TicketMarketIDs } from '../src/modules/ticket-market/constants.js';
import {
    normalizeSettings,
    parseAdDraft,
    TicketMarketModule,
    TicketMarketPanelPages,
    validateMarketAccessRole
} from '../src/modules/ticket-market/index.js';

const TicketMarketPanelComponentBudget = 40;

test('ticket market ad draft validates ticket count and price cap', () => {
    expect(
        parseAdDraft(
            {
                [TicketMarketIDs.AdTickets]: '3',
                [TicketMarketIDs.AdPrice]: '2000000',
                [TicketMarketIDs.AdNote]: 'Ping in trading.'
            },
            { maxPrice: 2_000_000 }
        )
    ).toEqual({
        note: 'Ping in trading.',
        price: 2_000_000,
        tickets: 3
    });

    expect(
        parseAdDraft(
            {
                [TicketMarketIDs.AdTickets]: '0',
                [TicketMarketIDs.AdPrice]: '1'
            },
            { maxPrice: 2_000_000 }
        )
    ).toEqual({ error: 'Enter a positive number of Wrapped Tickets.' });

    expect(
        parseAdDraft(
            {
                [TicketMarketIDs.AdTickets]: '1',
                [TicketMarketIDs.AdPrice]: '2000001'
            },
            { maxPrice: 2_000_000 }
        )
    ).toEqual({ error: 'Ticket ads cannot charge more than 2,000,000 per ticket.' });
});

test('ticket market settings normalize invalid numeric values to defaults', () => {
    expect(
        normalizeSettings({
            maxPrice: -1,
            adCooldown: -1,
            availabilityTimeout: -1,
            tradingLocked: false
        })
    ).toMatchObject({
        maxPrice: 2_000_000,
        adCooldown: 15 * 60 * 1000,
        availabilityTimeout: 15 * 60 * 1000,
        tradingLocked: false
    });

    expect(
        normalizeSettings({
            maxPrice: 1_000_000,
            adCooldown: 0,
            availabilityTimeout: 0
        })
    ).toMatchObject({
        maxPrice: 1_000_000,
        adCooldown: 0,
        availabilityTimeout: 0,
        tradingLocked: true
    });
});

test('ticket market settings omit unconfigured Discord IDs', () => {
    expect(
        normalizeSettings({
            marketAccessRoleID: '',
            controlChannelID: ' 123 ',
            sellerAdsChannelID: undefined
        })
    ).toMatchObject({
        controlChannelID: '123',
        maxPrice: 2_000_000,
        tradingLocked: true
    });
    expect(normalizeSettings({})).not.toHaveProperty('marketAccessRoleID');
    expect(normalizeSettings({})).not.toHaveProperty('sellerAdsChannelID');
});

test('ticket market access role must have no inherent permissions', () => {
    expect(validateMarketAccessRole({ id: 'role-1', permissions: '0' })).toEqual({});

    expect(validateMarketAccessRole({ id: 'role-2', permissions: '8' })).toEqual({
        error: 'Choose a role with no server permissions. Ticket Market access should only come from channel overwrites.'
    });

    expect(validateMarketAccessRole({ id: 'role-3', managed: true, permissions: '0' })).toEqual({
        error: 'Choose a normal role. Managed roles cannot be used for Ticket Market access.'
    });

    expect(validateMarketAccessRole(undefined)).toEqual({
        error: 'I could not inspect that role. Try selecting the role again.'
    });
});

test('ticket market module panel pages stay within the Discord component budget', () => {
    const module = new TicketMarketModule({
        config: createTicketMarketTestConfig(),
        databases: createTicketMarketTestDatabases(),
        logging: createTicketMarketTestLogging()
    });

    for (const pageID of [ModuleRuntimePageID, ...Object.values(TicketMarketPanelPages)]) {
        const panel = buildModulePanel(createTicketMarketPanelContext(), module, { pageID });

        expect(countMessageComponents(panel)).toBeLessThanOrEqual(TicketMarketPanelComponentBudget);
        expect(findDuplicateCustomIDs(panel)).toEqual([]);
    }
});

function countMessageComponents(messageOrComponents) {
    const components = Array.isArray(messageOrComponents)
        ? messageOrComponents
        : (messageOrComponents.components ?? []);
    let total = 0;

    for (const component of components) {
        total += 1;

        if (component.components) {
            total += countMessageComponents(component.components);
        }

        if (component.accessory) {
            total += countMessageComponents([component.accessory]);
        }
    }

    return total;
}

function findDuplicateCustomIDs(messageOrComponents) {
    const customIDs = collectCustomIDs(messageOrComponents);
    const seen = new Set();
    const duplicates = new Set();

    for (const customID of customIDs) {
        if (seen.has(customID)) {
            duplicates.add(customID);
        }
        seen.add(customID);
    }

    return [...duplicates];
}

function collectCustomIDs(messageOrComponents) {
    const components = Array.isArray(messageOrComponents)
        ? messageOrComponents
        : (messageOrComponents.components ?? []);
    const customIDs = [];

    for (const component of components) {
        if (component.custom_id) {
            customIDs.push(component.custom_id);
        }

        customIDs.push(...collectCustomIDs(component.components ?? []));

        if (component.accessory) {
            customIDs.push(...collectCustomIDs([component.accessory]));
        }
    }

    return customIDs;
}

function createTicketMarketPanelContext() {
    return {
        config: createTicketMarketTestConfig()
    };
}

function createTicketMarketTestConfig() {
    return {
        colors: {
            primary: 0x3498db,
            success: 0x2ecc71,
            warning: 0xf1c40f
        },
        discord: {
            guildId: 'guild-1'
        },
        modules: {
            defaultLogsLimit: 100
        }
    };
}

function createTicketMarketTestDatabases() {
    return {
        owo: {
            mysql: {
                pool: {}
            }
        },
        snail: {
            mongo: {
                connection: {
                    models: {},
                    model() {
                        return {};
                    }
                },
                User: {},
                UserLog: {}
            }
        }
    };
}

function createTicketMarketTestLogging() {
    return {
        createLogger() {
            return {
                debug() {},
                error() {},
                getEntries() {
                    return [];
                },
                info() {},
                trace() {},
                warn() {},
                time() {
                    return {
                        end() {},
                        fail() {}
                    };
                }
            };
        }
    };
}
