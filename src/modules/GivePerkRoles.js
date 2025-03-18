const { isOwOGuild, hasRole, hasRoles } = require('../utils/permissions');
const { getUid } = require('../utils/global');
const query = require('../databases/mysql/mysql.js');

module.exports = class GivePerkRoles extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'perkroles',
            name: 'Give Perk Roles',
            description: `Gives perk roles if they have a subscription`,
            toggleable: true,
        });

        this.cachedUserPerk = {};

        this.addEvent('guildMemberUpdate', this.guildMemberUpdate);
        this.addEvent('guildMemberAdd', this.guildMemberUpdate);
        this.addEvent('messageCreate', this.messageCreate);
    }

    guildMemberUpdate(guild, member) {
        this.checkPerkRoles(guild, member);
    }

    messageCreate({ author, channel, member }) {
        if (author.bot) return; // Ignore if bot,

        this.checkPerkRoles(channel.guild, member);
    }

    async checkPerkRoles(guild, member, force = false) {
        if (!isOwOGuild(guild)) return; // Ignore if not OwO bot server
        if (!force && !this.shouldFetchPerk(member)) return;
        this.cachedUserPerk[member.id] = new Date();

        const perks = await this.fetchPerk(member);

        const disabled = !!(await this.bot.snail_db.User.findById(member.id, 'snailRoles'))?.snailRoles;

        await this.updateRoles(member, perks, disabled);
    }

    updateRoles(member, { ticket, discord, patreon }, disabled) {
        console.log(
            `${member.id} = ticket:${ticket.benefitRank}, discord:${discord.benefitRank}, patreon:${patreon.benefitRank}, disabled:${disabled}`
        );
        if (ticket.benefitRank + discord.benefitRank + patreon.benefitRank > 0) {
            this.addRoleIfNotExist(member, this.bot.config.roles.supporters.base);
        } else {
            this.removeBaseRole(member);
        }

        // Remove ticket and discord roles (patreon roles are handled by patreon bot)
        if (disabled) {
            this.removeRoleIfExist(member, this.bot.config.roles.supporters.commonTicket);
            this.removeRoleIfExist(member, this.bot.config.roles.supporters.uncommonDiscord);
            return;
        }

        switch (ticket.benefitRank) {
            case 0:
                this.removeRoleIfExist(member, this.bot.config.roles.supporters.commonTicket);
                break;
            case 1:
                this.addRoleIfNotExist(member, this.bot.config.roles.supporters.commonTicket);
                break;
            case 3:
                // Temporary common role
                this.addRoleIfNotExist(member, this.bot.config.roles.supporters.commonTicket);
                break;
            default:
                console.error(`Unknown ticket rank: ${ticket.benefitRank}`);
                return;
        }

        switch (discord.benefitRank) {
            case 0:
                this.removeRoleIfExist(member, this.bot.config.roles.supporters.uncommonDiscord);
                break;
            case 3:
                this.addRoleIfNotExist(member, this.bot.config.roles.supporters.uncommonDiscord);
                break;
            default:
                console.error(`Unknown discord rank: ${discord.benefitRank}`);
                return;
        }

        switch (patreon.benefitRank) {
            case 0:
                this.removeRoleIfExist(member, this.bot.config.roles.supporters.commonPatreon);
                this.removeRoleIfExist(member, this.bot.config.roles.supporters.uncommonPatreon);
                break;
            case 1:
                /* no-op */
                break;
            case 3:
                /* no-op */
                break;
            default:
                console.error(`Unknown patreon rank: ${patreon.benefitRank}`);
                return;
        }
    }

    removeBaseRole(member) {
        const higherTiers = [
            this.bot.config.roles.supporters.legendaryDonator,
            this.bot.config.roles.supporters.fabledDonator,
        ];
        if (!hasRoles(member, higherTiers)) {
            this.removeRoleIfExist(member, this.bot.config.roles.supporters.base);
        }
    }

    removeRoleIfExist(member, roleId) {
        if (hasRole(member, roleId)) {
            console.log(`Removing role ${roleId} from ${member.id}`);
            member.removeRole(roleId);
        }
    }

    addRoleIfNotExist(member, roleId) {
        if (!hasRole(member, roleId)) {
            console.log(`Adding role ${roleId} to ${member.id}`);
            member.addRole(roleId);
        }
    }

    shouldFetchPerk(member) {
        if (!this.cachedUserPerk[member.id]) return true;

        const diff = new Date() - this.cachedUserPerk[member.id];
        // Refresh if its past a day
        if (diff >= 1000 * 60 * 60 * 24) {
            delete this.cachedUserPerk[member.id];
            return true;
        }

        return false;
    }

    async fetchPerk(member) {
        const ticket = {
            endTime: null,
            benefitRank: 0,
            updatedOn: new Date(),
        };
        const discord = {
            endTime: null,
            benefitRank: 0,
            updatedOn: new Date(),
        };
        const patreon = {
            endTime: null,
            benefitRank: 0,
            updatedOn: new Date(),
        };
        const perks = { ticket, discord, patreon };

        const uid = await getUid(member);
        if (!uid) return perks;

        const sql = `
				SELECT * FROM patreons WHERE uid = ${uid};
				SELECT * FROM patreon_wh WHERE uid = ${uid};
				SELECT * FROM patreon_discord WHERE uid = ${uid};
			`;
        const result = await query(sql);

        if (result[0][0]?.patreonTimer) {
            const benefitRank = result[0][0].patreonType;
            const startTime = new Date(result[0][0].patreonTimer);
            const endTime = new Date(startTime.setMonth(startTime.getMonth() + result[0][0].patreonMonths));
            this.getBetterPerk(ticket, benefitRank, endTime);
        }
        if (result[1].length) {
            result[1].forEach((row) => {
                const benefitRank = row.patreonType;
                const endTime = new Date(row.endDate);
                this.getBetterPerk(patreon, benefitRank, endTime);
            });
        }
        if (result[2][0]) {
            const benefitRank = result[2][0].patreonType;
            let endTime = new Date(result[2][0].endDate);
            if (result[2][0].active) {
                endTime = new Date();
                endTime = new Date(endTime.setMonth(endTime.getMonth() + 1));
            }
            this.getBetterPerk(discord, benefitRank, endTime);
        }

        return perks;
    }

    getBetterPerk(perk, benefitRank, endTime) {
        const now = new Date();
        if (endTime < now) {
            return;
        }
        if (benefitRank > perk.benefitRank) {
            perk.endTime = endTime;
            perk.benefitRank = benefitRank;
        } else if (benefitRank == perk.benefitRank) {
            if (endTime > perk.endTime) {
                perk.endTime = endTime;
            }
        }
    }
};
