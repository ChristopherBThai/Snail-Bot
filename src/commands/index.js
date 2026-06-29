import logs from './logs.js';
import module from './module.js';
import snail from './snail.js';
import { createTagCommands } from './tag/index.js';

export function createCommands({ config, databases, logging } = {}) {
    return [
        snail,
        module,
        logs({ databases, logging }),
        ...createTagCommands({
            config,
            databases,
            logging
        })
    ];
}

export default createCommands;
