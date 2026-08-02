import { ApplicationCommandType } from 'discord-api-types/v10';

export default function setup() {
    return {
        name: 'Snail Command',
        commands: [
            {
                definition: {
                    type: ApplicationCommandType.ChatInput,
                    name: 'snail',
                    description: '🐌',
                },
                async handle({ respond }) {
                    await respond('🐌');
                },
            },
        ],
    };
}
