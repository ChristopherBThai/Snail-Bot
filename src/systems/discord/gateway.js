import { createGatewayManager } from '@discordeno/gateway';
import { GatewayIntentBits } from 'discord-api-types/v10';

export function createDiscordGateway({ router, token }) {
    const gateway = createGatewayManager({
        token,
        intents: GatewayIntentBits.GuildMessages,
        resharding: { enabled: false },
        preferSnakeCase: true,
        events: {
            async message(_shard, payload) {
                if (payload.t === 'READY') {
                    console.info(`Snail is ready as ${payload.d.user.username}#${payload.d.user.discriminator}.`);
                }

                await router.route(payload);
            }
        }
    });

    return {
        start() {
            return gateway.spawnShards();
        }
    };
}
