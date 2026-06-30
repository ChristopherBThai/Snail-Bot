import { createEchoCommand } from './echo.js';
import { createEditCommand } from './edit.js';
import logs from './logs.js';
import module from './module.js';
import snail from './snail.js';
import { createTagCommands } from './tag/index.js';

export function createCommands({ config, databases, logging, messageBuilder } = {}) {
    if (!messageBuilder) {
        throw new Error('createCommands requires a Message Builder system.');
    }

    return [
        snail,
        module,
        logs({ databases, logging }),
        createEchoCommand({ messageBuilder }),
        createEditCommand({ messageBuilder }),
        ...createTagCommands({
            config,
            databases,
            messageBuilder
        })
    ];
}

export default createCommands;
