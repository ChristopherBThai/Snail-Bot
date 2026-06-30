import { expect, test } from 'vitest';
import { createEchoCommand } from '../src/commands/echo.js';
import { createLogging, LogLevels } from '../src/systems/logger/index.js';
import { BuilderActions, BuilderIDs } from '../src/systems/message-builder/constants.js';
import { createMessageBuilder } from '../src/systems/message-builder/index.js';
import { createContext, createDatabases } from './helpers/tagsMessageBuilder.js';

function createEchoCommandSet() {
    const databases = createDatabases();
    const logging = createLogging({ limit: 100 });

    logging.setLevel('message_builder', LogLevels.Trace);

    const messageBuilder = createMessageBuilder({ databases, logging });

    return {
        command: createEchoCommand({ messageBuilder }),
        databases,
        messageBuilder
    };
}

function actionRoute(messageBuilder) {
    return messageBuilder.routes.components.find((route) => route.prefix === `${BuilderIDs.Action}:`);
}

function modalRoute(messageBuilder, id) {
    return messageBuilder.routes.modals.find((route) => route.prefix === `${id}:`);
}

function actionSelect(message) {
    return message.components
        .flatMap((component) => component.components ?? [])
        .find((component) => component.custom_id?.startsWith(BuilderIDs.Action));
}

test('echo sends raw text to the selected channel with mentions enabled', async () => {
    const { command } = createEchoCommandSet();
    const context = createContext({
        data: {
            options: [
                { name: 'channel', value: '222222222222222222' },
                { name: 'message', value: 'Hello <@123456789012345678>' }
            ]
        }
    });

    await command.handle(context);

    expect(context.sentMessages).toEqual([
        {
            channelID: '222222222222222222',
            message: expect.objectContaining({
                components: [expect.objectContaining({ content: 'Hello <@123456789012345678>' })]
            })
        }
    ]);
    expect(context.sentMessages[0].message.allowed_mentions).toBeUndefined();
    expect(context.response.components[0].content).toBe('Echoed message in <#222222222222222222>.');
});

test('echo opens Message Builder when message is omitted', async () => {
    const { command } = createEchoCommandSet();
    const context = createContext({
        data: { options: [{ name: 'channel', value: '222222222222222222' }] }
    });

    await command.handle(context);

    expect(context.response.components[0].content).toContain('Target: Send to <#222222222222222222>');
    expect(context.response.flags & 64).toBe(64);
});

test('echo Message Builder previews suppress mentions but final send enables them', async () => {
    const { command, messageBuilder, databases } = createEchoCommandSet();
    const context = createContext({
        data: { options: [{ name: 'channel', value: '222222222222222222' }] },
        userID: 'echo-builder'
    });

    await command.handle(context);
    expect(context.response.allowed_mentions).toEqual({ parse: [] });

    const addTextContext = createContext({
        customID: actionSelect(context.response).custom_id,
        data: { values: [BuilderActions.AddText] },
        userID: 'echo-builder'
    });
    await actionRoute(messageBuilder).handle(addTextContext);

    const textContext = createContext({
        customID: addTextContext.openedModal.custom_id,
        modalValues: { [BuilderIDs.TextInput]: 'Built hello <@123456789012345678>' },
        userID: 'echo-builder'
    });
    await modalRoute(messageBuilder, BuilderIDs.TextModal).handle(textContext);

    const saveContext = createContext({
        customID: actionSelect(textContext.editMessage).custom_id,
        data: { values: [BuilderActions.Submit] },
        userID: 'echo-builder'
    });
    await actionRoute(messageBuilder).handle(saveContext);

    expect(saveContext.sentMessages).toEqual([
        {
            channelID: '222222222222222222',
            message: expect.objectContaining({
                components: [expect.objectContaining({ content: 'Built hello <@123456789012345678>' })]
            })
        }
    ]);
    expect(saveContext.sentMessages[0].message.allowed_mentions).toBeUndefined();
    expect(saveContext.editMessage.components[0].content).toBe('Sent built message to <#222222222222222222>.');
    expect(databases.builderDrafts.get('echo-builder').blocks).toEqual([
        { kind: 'text', content: 'Built hello <@123456789012345678>' }
    ]);
});
