import { expect, test } from 'vitest';
import nick from '../src/commands/nick.js';
import { createContext } from './helpers/tagsMessageBuilder.js';

test('nick rejects usage outside a server', async () => {
    const context = createContext({
        data: {
            options: [{ name: 'nickname', value: 'Snail Jr' }]
        }
    });
    context.guildID = undefined;

    await nick.handle(context);

    expect(context.response.components[0].content).toBe('Use this in a server.');
    expect(context.editedNicknames).toEqual([]);
});

test('nick sets the bot nickname', async () => {
    const context = createContext({
        data: {
            options: [{ name: 'nickname', value: '  Snail Jr  ' }]
        }
    });
    context.guildID = 'guild-1';

    await nick.handle(context);

    expect(context.editedNicknames).toEqual([{ guildID: 'guild-1', nickname: 'Snail Jr' }]);
    expect(context.response.components[0].content).toBe('I have set my nickname to `Snail Jr`.');
});

test('nick reset clears the bot nickname', async () => {
    const context = createContext({
        data: {
            options: [{ name: 'nickname', value: 'RESET' }]
        }
    });
    context.guildID = 'guild-1';

    await nick.handle(context);

    expect(context.editedNicknames).toEqual([{ guildID: 'guild-1', nickname: null }]);
    expect(context.response.components[0].content).toBe('I have reset my nickname.');
});
