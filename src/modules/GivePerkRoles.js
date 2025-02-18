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
    }

    guildMemberUpdate(guild, member) {
        this.checkPerkRoles(guild, member);
    }

    async checkPerkRoles(guild, member, force = false) {
        if (!isOwOGuild(guild)) return; // Ignore if not OwO bot server
        if (!force && !this.shouldFetchPerk(member)) return;

        const perk = await this.fetchPerk(member);
        this.cachedUserPerk[member.id] = perk;

        await this.updateRoles(member, perk);
    }

    updateRoles(member, perk) {
        switch (perk.benefitRank) {
            case 0:
                this.removeRoles(member);
                break;
            case 1:
                this.addRoleIfNotExist(member, this.bot.config.roles.supporters.base);
                this.addRoleIfNotExist(member, this.bot.config.roles.supporters.commonSupporter);
                this.removeRoleIfExist(member, this.bot.config.roles.supporters.uncommonSupporter);
                break;
            case 3:
                this.addRoleIfNotExist(member, this.bot.config.roles.supporters.base);
                this.removeRoleIfExist(member, this.bot.config.roles.supporters.commonSupporter);
                this.addRoleIfNotExist(member, this.bot.config.roles.supporters.uncommonSupporter);
                break;
            default:
                console.error(`Unknown benefit rank: ${perk}`);
                return;
        }
    }

    removeRoles(member) {
        const higherTiers = [
            this.bot.config.roles.supporters.rareSupporter,
            this.bot.config.roles.supporters.epicSupporter,
            this.bot.config.roles.supporters.mythicalSupporter,
            this.bot.config.roles.supporters.legendarySupporter,
            this.bot.config.roles.supporters.legendaryDonator,
            this.bot.config.roles.supporters.fabledDonator,
        ];
        if (!hasRoles(member, higherTiers)) {
            this.removeRoleIfExist(member, this.bot.config.roles.supporters.base);
        }
        this.removeRoleIfExist(member, this.bot.config.roles.supporters.commonSupporter);
        this.removeRoleIfExist(member, this.bot.config.roles.supporters.uncommonSupporter);
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
        const perk = this.cachedUserPerk[member.id];

        const diff = new Date() - this.cachedUserPerk[member.id].updatedOn;
        // Refresh if its past a day
        if (diff >= 1000 * 60 * 60 * 24) {
            delete this.cachedUserPerk[member.id];
            return true;
        }

        if (perk.endTime && perk.endTime < new Date()) {
            return true;
        }

        return false;
    }

    async fetchPerk(member) {
        const perk = {
            endTime: null,
            benefitRank: 0,
            updatedOn: new Date(),
        };

        const uid = await getUid(member);
        if (!uid) return perk;

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
            this.getBetterPerk(perk, benefitRank, endTime);
        }
        if (result[1].length) {
            result[1].forEach((row) => {
                const benefitRank = row.patreonType;
                const endTime = new Date(row.endDate);
                this.getBetterPerk(perk, benefitRank, endTime);
            });
        }
        if (result[2][0]) {
            const benefitRank = result[2][0].patreonType;
            let endTime = new Date(result[2][0].endDate);
            if (result[2][0].active) {
                endTime = new Date();
                endTime = new Date(endTime.setMonth(endTime.getMonth() + 1));
            }
            this.getBetterPerk(perk, benefitRank, endTime);
        }

        return perk;
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
