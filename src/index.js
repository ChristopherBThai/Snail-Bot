import { start } from './runtime/start.js';

start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
