import { expect, test } from 'vitest';
import { createEditCommand } from '../src/commands/edit.js';
import { ComponentType } from '../src/systems/discord/components.js';
import { createLogging, LogLevels } from '../src/systems/logger/index.js';
import { BuilderActions, BuilderIDs } from '../src/systems/message-builder/constants.js';
import { createMessageBuilder } from '../src/systems/message-builder/index.js';
import { createContext, createDatabases } from './helpers/tagsMessageBuilder.js';

function createEditCommandSet() {
    const databases = createDatabases();
    const logging = createLogging({ limit: 100 });

    logging.setLevel('message_builder', LogLevels.Trace);

    const messageBuilder = createMessageBuilder({ databases, logging });

    return {
        command: createEditCommand({ messageBuilder }),
        databases,
        messageBuilder
    };
}

function actionRoute(messageBuilder) {
    return messageBuilder.routes.components.find((route) => route.prefix === `${BuilderIDs.Action}:`);
}

function actionSelect(message) {
    return message.components
        .flatMap((component) => component.components ?? [])
        .find((component) => component.custom_id?.startsWith(BuilderIDs.Action));
}

test('edit rejects missing target messages', async () => {
    const { command } = createEditCommandSet();
    const context = createContext();

    await command.handle(context);

    expect(context.response.components[0].content).toBe('Could not read that message.');
});

test('edit rejects messages not authored by Snail', async () => {
    const { command } = createEditCommandSet();
    const context = createContext({
        data: { target_id: 'message-1' },
        interaction: undefined
    });
    context.targetID = 'message-1';
    context.target = {
        author: { id: 'someone-else' },
        channel_id: '222222222222222222',
        content: 'Not ours',
        id: 'message-1'
    };

    await command.handle(context);

    expect(context.response.components[0].content).toBe('I can only edit messages sent by Snail.');
});

test('edit opens Message Builder from a Snail-authored editable message', async () => {
    const { command } = createEditCommandSet();
    const context = createContext({
        userID: 'edit-user'
    });
    context.targetID = 'message-1';
    context.target = {
        author: { id: 'bot-application' },
        channel_id: '222222222222222222',
        components: [{ type: ComponentType.TextDisplay, content: 'Existing text' }],
        id: 'message-1'
    };

    await command.handle(context);

    expect(context.response.components[0].content).toContain('Target: Edit message');
    expect(JSON.stringify(context.response.components)).toContain('Existing text');
});

test('edit submits Message Builder draft by editing the original message with mentions enabled', async () => {
    const { command, messageBuilder, databases } = createEditCommandSet();
    const context = createContext({
        userID: 'edit-user'
    });
    context.targetID = 'message-1';
    context.target = {
        author: { id: 'bot-application' },
        channel_id: '222222222222222222',
        content: 'Built hello <@123456789012345678>',
        id: 'message-1'
    };

    await command.handle(context);
    expect(context.response.allowed_mentions).toEqual({ parse: [] });

    const submitContext = createContext({
        customID: actionSelect(context.response).custom_id,
        data: { values: [BuilderActions.Submit] },
        userID: 'edit-user'
    });
    await actionRoute(messageBuilder).handle(submitContext);

    expect(submitContext.editedMessages).toEqual([
        {
            channelID: '222222222222222222',
            messageID: 'message-1',
            message: expect.objectContaining({
                attachments: [],
                content: null,
                components: [expect.objectContaining({ content: 'Built hello <@123456789012345678>' })]
            })
        }
    ]);
    expect(submitContext.editedMessages[0].message.allowed_mentions).toBeUndefined();
    expect(submitContext.editMessage.components[0].content).toBe('Updated the message.');
    expect(databases.builderDrafts.get('edit-user').blocks).toEqual([
        { kind: 'text', content: 'Built hello <@123456789012345678>' }
    ]);
});

test('edit rejects unsupported message shapes before opening Message Builder', async () => {
    const { command } = createEditCommandSet();
    const context = createContext();
    context.targetID = 'message-1';
    context.target = {
        author: { id: 'bot-application' },
        channel_id: '222222222222222222',
        embeds: [{ title: 'Unsupported' }],
        id: 'message-1'
    };

    await command.handle(context);

    expect(context.response.components[0].content).toBe('That message cannot be edited because it has embeds.');
});
