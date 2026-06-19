export default {
    definition: {
        name: 'snail',
        description: '🐌'
    },

    async handle(context) {
        await context.respond('🐌');
    }
};
