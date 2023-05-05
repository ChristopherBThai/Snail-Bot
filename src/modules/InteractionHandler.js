const QUEST_DATA = require("../data/quests.json");

module.exports = class InteractionHandler {
    constructor(bot) {
        this.bot = bot;
        this.events = {
            "interactionCreate": this.handleInteraction
        }
    }

    async handleInteraction(interaction) {
        // If I add more interaction based features, then I'll make a handler, but for now this is fine. Maybe should move this to quest list module but ehhhhh
        const custom_id = interaction.data?.custom_id;

        if (custom_id == "questlist_queue_position") {
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
        } else if (custom_id == "questlist_reload_mentions") {
            const USERS_ON_LIST = Object.fromEntries(Object.keys(QUEST_DATA).map(type => [type, new Array()]));

            for (const { type, discordID } of this.bot.questList.quests) {
                if (!USERS_ON_LIST[type].some(userID => userID == discordID)) USERS_ON_LIST[type].push(discordID);
            }

            let content = Object.entries(USERS_ON_LIST).map(([type, userIDs]) => {
                let base = `__**${QUEST_DATA[type].name}:**__`

                const MAX = this.bot.questList.maxQuests[type] ?? userIDs.length;
                const USERS_ON_DISPLAY = userIDs.splice(0, MAX);

                return `${base} ${USERS_ON_DISPLAY.map(userID => `<@${userID}>`).join(" ")}`;
            }).join("\n");

            await interaction.createMessage({ content, flags: 1 << 6 });
        } else if (custom_id == "questlist_toggle_reminders") {
            let enabled = (await this.bot.snail_db.User.findById(interaction.member?.id))?.reminders?.luck?.enabled;

            await this.bot.snail_db.User.updateOne({ _id: interaction.member?.id }, { reminders: { luck: { enabled: !(enabled ?? false) } } }, { upsert: true });

            await interaction.createMessage({ content: `You have ${!enabled ? "enabled" : "disabled"} pray/curse reminders for this channel.`, flags: 1 << 6 });
        }
    }
};