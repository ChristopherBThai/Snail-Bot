import { ApplicationCommandOptionType } from 'discord-api-types/v10';
import { ephemeralText } from '../systems/discord/components.js';
import { auth, getOptionValue } from '../utils.js';

const ResetNick = 'reset';

export default {
    auth: auth.manager,
    staff: true,
    definition: {
        name: 'nick',
        description: "Set or reset Snail's server nickname.",
        options: [
            {
                name: 'nickname',
                description: 'The new nickname, or reset to clear it.',
                type: ApplicationCommandOptionType.String,
                required: true,
                min_length: 1,
                max_length: 32
            }
        ]
    },
    async handle(context) {
        const guildID = context.guildID;
        const nickname = String(getOptionValue(context.data, 'nickname') ?? '').trim();

        if (!guildID) {
            await context.respond(ephemeralText('Use this in a server.'));
            return;
        }

        if (!nickname) {
            await context.respond(ephemeralText('Please provide a nickname.'));
            return;
        }

        const reset = nickname.toLowerCase() === ResetNick;
        await context.editBotNickname(guildID, reset ? null : nickname);

        await context.respond(
            ephemeralText(reset ? 'I have reset my nickname.' : `I have set my nickname to \`${nickname}\`.`)
        );
    }
};
