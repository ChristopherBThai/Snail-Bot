import { ApplicationCommandType } from 'discord-api-types/v10';

export default {
    routes: [
        {
            kind: 'command',
            id: 'snail:command',
            command: {
                type: ApplicationCommandType.ChatInput,
                name: 'snail',
                description: '🐌'
            },
            handle(context) {
                return context.respond('🐌');
            }
        }
    ]
};
