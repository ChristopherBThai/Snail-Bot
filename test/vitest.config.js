const { defineConfig } = require('vitest/config');
const { loadEnv } = require('vite');

module.exports = defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    return {
        test: {
            globals: true,
            env
        }
    };
});