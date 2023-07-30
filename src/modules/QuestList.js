const QUEST_DATA = require('../data/quests.json');
const { ephemeralResponse } = require('../utils/sender');
const { getName } = require('../utils/global');

const COMPLETED_QUEST_TRIGGER = 'You finished a quest and earned';
const UPDATE_TRIGGER_PHRASES = [COMPLETED_QUEST_TRIGGER, 'prays for', 'puts a curse on', 'You got a cookie from'];
const MESSAGE_TIMEOUT = 15000;
const EMBED_FIELD_CHARACTER_LIMIT = 1023; // One less just to be safe
const COMPONENTS = [
    {
        type: 1,
        components: [
            {
                type: 2,
                label: 'Queue Position',
                style: 1,
                custom_id: 'questlist_queue_position',
            },
            {
                type: 2,
                label: 'Reload Mentions',
                style: 1,
                custom_id: 'questlist_reload_mentions',
            },
            {
                type: 2,
                label: 'Toggle Reminders',
                style: 1,
                custom_id: 'questlist_toggle_reminders',
            },
        ],
    },
];

module.exports = class QuestList extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'questlist',
            name: 'Quest List',
            description: 'Manages a list of quests in a dedicated channel to help users complete their quests.',
            toggleable: true,
        });

        // Defaults
        this.quests = [];
        this.message = null;
        this.capacity = {
            cookieBy: 5,
            prayBy: 10,
            curseBy: 10,
            emoteBy: 5,
        };
        this.repostInterval = 15;
        this.lastSent = this.repostInterval;
        this.channel = undefined;
        this.warnings = {};
        this.emptyMessage = 'There are no quests!';

        this.addEvent('UserMessage', this.onUserMessage);
        this.addEvent('OwOMessage', this.onOwOMessage);
        this.addEvent('OwOCommand', this.onOwOCommand);
        this.addEvent('guildMemberRemove', this.onLeave);
        this.addEvent('interactionCreate', this.onButtonPress);
    }

    async onceReady() {
        await super.onceReady();

        this.capacity = {
            cookieBy: (await this.bot.getConfiguration(`${this.id}_cookie_capacity`)) ?? this.capacity.cookieBy,
            prayBy: (await this.bot.getConfiguration(`${this.id}_pray_capacity`)) ?? this.capacity.prayBy,
            curseBy: (await this.bot.getConfiguration(`${this.id}_curse_capacity`)) ?? this.capacity.curseBy,
            emoteBy: (await this.bot.getConfiguration(`${this.id}_emote_capacity`)) ?? this.capacity.emoteBy,
        };

        this.repostInterval = (await this.bot.getConfiguration(`${this.id}_repost_interval`)) ?? this.repostInterval;
        this.lastSent = this.repostInterval;
        this.channel = (await this.bot.getConfiguration(`${this.id}_channel`)) ?? this.channel;
        this.emptyMessage = (await this.bot.getConfiguration(`${this.id}_empty_message`)) ?? this.emptyMessage;

        // Persistent quests between bot restarts
        const SAVED_QUESTS = ((await this.bot.snail_db.Quest.find({})) ?? []).sort((a, b) => a.added - b.added);
        const USERS_ON_LIST = [...new Set(SAVED_QUESTS.map((quest) => quest.discordID))];
        const QUESTS = await this.getUsersQuests(USERS_ON_LIST);
        this.quests = SAVED_QUESTS.map((quest) => {
            return { ...QUESTS.find((other) => areSameQuest(quest, other)), added: quest.added };
        }).filter((quest) => quest.locked == 0);
    }

    async onUserMessage(message) {
        if (message.channel.id != this.channel) return;

        // All non bot messages count toward the counter
        if (++this.lastSent >= this.repostInterval) await this.update();
    }

    async onOwOMessage(message) {
        if (message.channel.id != this.channel) return;

        // Delete quest logs to keep channel clean
        if (message.embeds?.[0]?.author?.name.endsWith('Quest Log')) {
            message.delete();
            return;
        }

        // Non log messages from OwO count toward the counter
        if (++this.lastSent >= this.repostInterval) await this.update();

        // Update whenever a quest is completed, someone is prayed to, someone is cursed, or receives a cookie
        if (UPDATE_TRIGGER_PHRASES.some((phrase) => message.content.includes(phrase))) await this.update();

        // React "🎉" to completed quests
        if (message.content.includes(COMPLETED_QUEST_TRIGGER)) await message.addReaction('🎉');
    }

    async onOwOCommand({ command, message }) {
        if (message.channel.id != this.channel) return;

        if (!['quest', 'q'].includes(command)) return;

        const USER_ID = message.author.id;

        const usersQuests = await this.getUsersQuests([USER_ID]);

        // Filter for the quests that can be added to the list
        const newQuests = usersQuests.filter((newQuest) => {
            return (
                Object.keys(QUEST_DATA).includes(newQuest.type) && // Check that it is a type of quest that can be added to the list
                newQuest.locked == 0 && // Check that the quest is unlocked
                !this.quests.some((quest) => areSameQuest(newQuest, quest))
            ); // Check that the quest is not already on the list
        });

        // Add the new quests to the list
        this.quests.push(
            ...newQuests.map((quest) => {
                return { ...quest, added: Date.now() };
            })
        );

        if (newQuests.length == 0) {
            const lastWarned = this.warnings[USER_ID] ?? new Date(0);
            const now = Date.now();
            const difference = now - lastWarned;

            // If not longer on warning cooldown
            if (difference > MESSAGE_TIMEOUT) {
                await ephemeralResponse(
                    message.channel,
                    `🚫 **|** <@${USER_ID}>, You don't have any new quests to add to the list! Only unlocked Cookie, Pray, Curse, and Action quests can be added!`,
                    MESSAGE_TIMEOUT
                );
                this.warnings[USER_ID] = now;
            }
        } else {
            let text =
                `<@${USER_ID}>, I have added your quest(s) to the list!\n` +
                newQuests
                    .map((quest) => {
                        let count = QUEST_DATA[quest.type].count[quest.level];
                        let text = QUEST_DATA[quest.type].text.replace('%count%', count);
                        return `- \`${text}\``;
                    })
                    .join('\n') +
                "\nPlease note that older quests will be shown first! If you don't see your quest it is in the queue! You can help out others with their quests to advance the queue faster!";

            await ephemeralResponse(message.channel, text, MESSAGE_TIMEOUT);
            await this.update();
        }

        message.delete();
    }

    async onLeave(guild, member) {
        this.quests = this.quests.filter((quest) => member.id != quest.discordID);
        await this.update();
    }

    async getUsersQuests(users) {
        if (users.length == 0) return [];
        const sql = `SELECT q.qname as type, q.level, q.count, UNIX_TIMESTAMP(q.claimed) as claimed, q.locked, u.id as discordID FROM quest q INNER JOIN user u ON q.uid = u.uid WHERE u.id IN (${users.join(
            ', '
        )}) ORDER BY claimed asc;`;
        return await this.bot.query_owo_db(sql);
    }

    async update() {
        const USERS_ON_LIST = [...new Set(this.quests.map((quest) => quest.discordID))];
        const UPDATED_QUESTS = await this.getUsersQuests(USERS_ON_LIST);

        // Map old quests to updated quests setting quests that have been removed as undefined and then filter for quests that still exist and aren't locked
        this.quests = this.quests
            .map((quest) => {
                return {
                    ...UPDATED_QUESTS.find((updatedQuest) => areSameQuest(updatedQuest, quest)),
                    added: quest.added,
                };
            })
            .filter((quest) => quest?.locked == 0);

        // Update quest list in database for presistence between restarts
        await this.bot.snail_db.Quest.deleteMany({});
        await this.bot.snail_db.Quest.insertMany(
            this.quests.map(({ discordID, claimed, added }) => {
                return { discordID, claimed, added };
            })
        );

        const QUESTS_GROUPED_BY_TYPE = this.quests.reduce((groups, quest) => {
            const TYPE = quest.type;
            groups[TYPE] = [...(groups[TYPE] ?? []), quest];
            return groups;
        }, {});

        const embed = {
            title: `Quest List`,
            description: `Use \`owo quest\` to have your quests added to the list! Battle and Action quests can be completed in spam channels. Please read the pins for information and FAQ.\n\n<#989702438317617173> <#989702567636394054> <#989702601648009276> <#989702633969295400> <#989702680911954010> <#556183345353064513> <#1113295567624339546>`,
            timestamp: new Date(),
            color: this.bot.config.embedcolor,
        };

        embed.fields = Object.entries(QUEST_DATA)
            .filter(([type]) => QUESTS_GROUPED_BY_TYPE[type])
            .map(([type, data]) => {
                let questCount = 0;
                let text = '';

                const QUESTS_GROUPED_BY_USER = QUESTS_GROUPED_BY_TYPE[type].reduce((groups, quest) => {
                    const USER = quest.discordID;
                    groups[USER] = [...(groups[USER] ?? []), quest];
                    return groups;
                }, {});

                for (const USER in QUESTS_GROUPED_BY_USER) {
                    let counts = QUESTS_GROUPED_BY_USER[USER].map(
                        ({ count, level }) =>
                            `\`${count.toString().padStart(2, '0')}/${data.count[level].toString().padStart(2, '0')}\``
                    ).join(' + ');

                    const QUEST_STRING = `${counts} \`${getName(
                        this.bot.guilds.get(this.bot.config.guild)?.members.get(USER)
                    )}\` <@${USER}>\n`;

                    if (text.length + QUEST_STRING.length > EMBED_FIELD_CHARACTER_LIMIT) break;

                    text += QUEST_STRING;
                    questCount++;

                    if (questCount >= this.capacity[type]) break;
                }

                return {
                    name: `${data.emoji} __${data.name} List__ (${questCount}/${Object.keys(QUESTS_GROUPED_BY_USER).length})`,
                    value:
                        text ??
                        "If you see this, then something broke lol. Tell <@210177401064390658>. Or don't... this will probably fix itself.",
                };
            });

        // If empty send the empty list message
        if (this.quests.length == 0) {
            embed.description += `\n\n${this.emptyMessage}`;
        }

        if (this.lastSent >= this.repostInterval || !this.message) {
            this.lastSent = 0;
            // @ts-ignore
            this.message = await this.bot.createMessage(this.channel, { embed, components: COMPONENTS });
        } else {
            // @ts-ignore
            await this.message.edit({ embed, components: COMPONENTS });
        }
    }

    async onButtonPress(interaction) {
        const {
            type,
            data: { custom_id },
            member: { id: MEMBER_ID },
        } = interaction;

        // If not a component interaction, ignore
        if (type != 3) return;

        switch (custom_id) {
            case 'questlist_queue_position': {
                const USERS_ON_LIST = Object.fromEntries(Object.keys(QUEST_DATA).map((type) => [type, new Array()]));

                for (const { type, discordID } of this.quests) {
                    if (!USERS_ON_LIST[type].includes(discordID)) USERS_ON_LIST[type].push(discordID);
                }

                const POSITIONS = {};

                for (const type in USERS_ON_LIST) {
                    POSITIONS[type] = USERS_ON_LIST[type].findIndex((userID) => userID == MEMBER_ID);
                }

                let content = Object.entries(POSITIONS)
                    .map(([type, position]) => {
                        let base = `__**${QUEST_DATA[type].name}:**__`;

                        if (position == -1) return `${base} You are not on this list`;

                        const MAX = this.capacity[type] ?? Infinity;

                        if (position < MAX) return `${base} Your quest is currently being shown`;

                        return `${base} Your quest is in the queue at position ${position - MAX + 1}`;
                    })
                    .join('\n');

                await interaction.createMessage({ content, flags: 1 << 6 });
                break;
            }
            case 'questlist_reload_mentions': {
                const USERS_ON_LIST = Object.fromEntries(Object.keys(QUEST_DATA).map((type) => [type, new Array()]));

                for (const { type, discordID } of this.quests) {
                    if (!USERS_ON_LIST[type].includes(discordID)) USERS_ON_LIST[type].push(discordID);
                }

                let content = Object.entries(USERS_ON_LIST)
                    .map(([type, userIDs]) => {
                        let base = `__**${QUEST_DATA[type].name}:**__`;

                        const MAX = this.capacity[type] ?? userIDs.length;
                        const USERS_ON_DISPLAY = userIDs.splice(0, MAX);

                        return `${base} ${USERS_ON_DISPLAY.map((userID) => `<@${userID}>`).join(' ')}`;
                    })
                    .join('\n');

                await interaction.createMessage({ content, flags: 1 << 6 });
                break;
            }
            case 'questlist_toggle_reminders': {
                let enabled = (await this.bot.snail_db.User.findById(MEMBER_ID))?.reminders?.luck?.enabled;
                await this.bot.snail_db.User.updateOne(
                    { _id: MEMBER_ID },
                    { reminders: { luck: { enabled: !(enabled ?? false) } } },
                    { upsert: true }
                );

                await interaction.createMessage({
                    content: `You have ${enabled ? 'disabled' : 'enabled'} pray/curse reminders.`,
                    flags: 1 << 6,
                });
                break;
            }
        }
    }

    getConfigurationOverview() {
        return (
            `${super.getConfigurationOverview()}\n` +
            `- Channel: <#${this.channel}>\n` +
            `- Max Quests\n` +
            ` - Cookie: ${this.capacity.cookieBy}\n` +
            ` - Pray: ${this.capacity.prayBy}\n` +
            ` - Curse: ${this.capacity.curseBy}\n` +
            ` - Action: ${this.capacity.emoteBy}\n` +
            `- Repost Interval: ${this.repostInterval}\n` +
            `- Empty Message:\n${this.emptyMessage}`
        );
    }
};

function areSameQuest(quest1, quest2) {
    return quest1.discordID == quest2.discordID && quest1.claimed == quest2.claimed;
}
