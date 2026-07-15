import { PermissionFlagsBits } from 'discord-api-types/v10';
import { describe, expect, test } from 'vitest';
import { getCommandSyncDefinition } from './command-sync.js';

describe('getCommandSyncDefinition', () => {
    test('strips Snail command sync metadata from public commands', () => {
        expect(
            getCommandSyncDefinition({
                command: {
                    type: 1,
                    name: 'snail',
                    description: 'Snail.',
                    global: true
                }
            })
        ).toEqual({
            type: 1,
            name: 'snail',
            description: 'Snail.'
        });
    });

    test('adds Discord visibility permissions to staff commands', () => {
        expect(
            getCommandSyncDefinition({
                command: {
                    type: 1,
                    name: 'nick',
                    description: "Set or reset Snail's server nickname.",
                    staff: true
                }
            })
        ).toEqual({
            type: 1,
            name: 'nick',
            description: "Set or reset Snail's server nickname.",
            default_member_permissions: PermissionFlagsBits.BypassSlowmode.toString()
        });
    });
});
