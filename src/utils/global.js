const query = require('../databases/mysql/mysql.js');
const CHANNEL_MENTION_REGEX = /^<#(?<id>\d{17,19})>$/;
const USER_MENTION_REGEX = /^<@!?(?<id>\d{17,19})>$/;
const SNOWFLAKE_REGEX = /^\d{17,19}$/;
// prettier-ignore
const MESSAGE_LINK_REGEX = /^https:\/\/discord\.com\/channels\/(?<guild>\d{17,19})\/(?<channel>\d{17,19})\/(?<message>\d{17,19})$/;
const cachedUid = {};

exports.parseChannelID = function (arg) {
    if (!arg) return;
    if (typeof arg != 'string') return;

    const mention = arg.match(CHANNEL_MENTION_REGEX)?.groups?.id;
    if (mention) return mention;
    else return arg.match(SNOWFLAKE_REGEX)?.[0];
};

exports.parseUserID = function (arg) {
    if (!arg) return;
    if (typeof arg != 'string') return;

    const mention = arg.match(USER_MENTION_REGEX)?.groups?.id;
    if (mention) return mention;
    else return arg.match(SNOWFLAKE_REGEX)?.[0];
};

exports.parseMessageLink = function (arg) {
    if (!arg) return;
    if (typeof arg != 'string') return;

    return arg.match(MESSAGE_LINK_REGEX)?.groups;
};

exports.parseEmoji = function (emoji) {
    let id = emoji.match(/:[0-9]+>$/gi);
    if (!id || !id[0]) return;
    id = id[0].match(/[0-9]+/gi)[0];
    let name = emoji.match(/:[\w]+:/gi);
    if (!name || !name[0]) return;
    name = name[0].slice(1, -1);
    return { id, name };
};

exports.getName = function (user) {
    return (
        user?.nick ||
        user?.globalname ||
        user?.global_name ||
        user?.user?.globalname ||
        user?.user?.global_name ||
        user?.username ||
        user?.user?.username ||
        'User'
    );
};

exports.getUniqueUsername = function (user) {
    user = user.user || user;
    if (user.discriminator && user.discriminator !== '0') {
        return `${user.username}#${user.discriminator}`;
    } else {
        return `@${user.username}`;
    }
};

exports.getUid = async function (user) {
    if (cachedUid[user.id]) {
        return cachedUid[user.id];
    }
    const sql = `SELECT uid FROM user WHERE id = ${user.id};`;
    const result = await query(sql);
    if (result[0]) {
        cachedUid[user.id] = result[0].uid;
        return result[0].uid;
    }
};

exports.validSnowflake = function (id) {
    return SNOWFLAKE_REGEX.test(id);
};

exports.fetchUser = async function (bot, id) {
    let user = bot.users.get(id);
    if (user) return user;

    try {
        user = await bot.getRESTUser(id);
        bot.users.add(user, this.bot, false);
        return user;
    } catch (err) {
        return;
    }
};
