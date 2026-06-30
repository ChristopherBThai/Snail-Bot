import { expect, test } from 'vitest';
import { createCommands } from '../src/commands/index.js';
import { createLogging } from '../src/systems/logger/index.js';
import { BuilderIDs } from '../src/systems/message-builder/constants.js';
import { createMessageBuilder } from '../src/systems/message-builder/index.js';
import { createDatabases } from './helpers/tagsMessageBuilder.js';

test('command composition consumes Message Builder without owning its routes', () => {
    const databases = createDatabases();
    const logging = createLogging({ limit: 100 });
    const messageBuilder = createMessageBuilder({ databases, logging });
    const commands = createCommands({
        config: { colors: { yellow: 0xf1c40f } },
        databases,
        logging,
        messageBuilder
    });

    expect(commands.map((command) => command.definition.name)).toEqual(
        expect.arrayContaining(['edit', 'echo', 'tag', 'tag-manage'])
    );
    expect(messageBuilder.routes.components.map((route) => route.prefix)).toEqual([
        `${BuilderIDs.SelectBlock}:`,
        `${BuilderIDs.Action}:`
    ]);
    expect(messageBuilder.routes.modals.map((route) => route.prefix)).toEqual([
        `${BuilderIDs.TextModal}:`,
        `${BuilderIDs.EditTextModal}:`,
        `${BuilderIDs.LinkModal}:`,
        `${BuilderIDs.SectionModal}:`,
        `${BuilderIDs.EditSectionModal}:`,
        `${BuilderIDs.MediaGalleryModal}:`,
        `${BuilderIDs.EditContainerModal}:`
    ]);
    const commandComponents = commands.flatMap((command) => command.components ?? []);
    const commandModals = commands.flatMap((command) => command.modals ?? []);
    expect(commandComponents).toEqual(expect.not.arrayContaining(messageBuilder.routes.components));
    expect(commandModals).toEqual(expect.not.arrayContaining(messageBuilder.routes.modals));
});
