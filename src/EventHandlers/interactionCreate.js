const QUEST_DATA = require("../data/quests.json");

module.exports = class InteractionCreateHandler {
    constructor(bot) {
        this.bot = bot;
    }

    async handle(interaction) {
        // If I add more interaction based features, then I'll make a handler, but for now this is fine
        if (interaction.data?.custom_id == "questlist_position") {
            const USERS_ON_LIST = Object.fromEntries(Object.keys(QUEST_DATA).map(type => [type, new Array()]));

            for (const { type, discordID } of this.bot.questList.quests) {
                if (!USERS_ON_LIST[type].some(userID => userID == discordID)) USERS_ON_LIST[type].push(discordID);
            }

            const POSITIONS = {};

            for (const type in USERS_ON_LIST) {
                POSITIONS[type] = USERS_ON_LIST[type].findIndex(userID => userID == interaction.member?.id);
            }

            let content = Object.entries(POSITIONS).map(([type, position]) => {
                let base = `__**${QUEST_DATA[type].name}:**__`

                if (position == -1) return `${base} You are not on this list`;

                const MAX = this.bot.questList.maxQuests[type] ?? Infinity;

                if (position < MAX) return `${base} Your quest is currently being shown`;

                return `${base} Your quest is in the queue at position ${position - MAX + 1}`;
            }).join("\n");

            await interaction.createMessage({ content, flags: 1 << 6 });
        }
    }
};