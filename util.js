const https = require('node:https');
const { roles: ROLES } = require(process.env.DEBUG ? './config.debug.json' : './config.json');

/** Used for flattening require-dir trees */
function* flattenRequireDir(object, targetClass) {
    for (const value of Object.values(object)) {
        if (value instanceof targetClass) yield value;
        // Technically can recurse for a while pointlessly if a file in the 
        // required directory exports a dense object, but this doesn't really happen  
        else if (typeof value === 'object' && value !== null) yield* flattenRequireDir(value, targetClass);
    }
}

/** Role helper functions */ 
/** 
 * @param {import('eris').Member?} member
 * @param {string} role
 */
function hasRole(member, role) {
    return member?.roles.includes(role) ?? false;
}

function isHelper(member) { return hasRole(member, ROLES.helper.perms); }
function isManager(member) { return hasRole(member, ROLES.manager.perms); }
function isAdmin(member) { return hasRole(member, ROLES.admin.perms); }
function isOwner(member) { return hasRole(member, ROLES.owner.perms); }
function isStaff(member) { return isHelper(member) || isManager(member) || isAdmin(member) || isOwner(member); }
function hasHelperPerms(member) { return isHelper(member) || isManager(member) || isAdmin(member) || isOwner(member); }
function hasManagerPerms(member) { return isManager(member) || isAdmin(member) || isOwner(member); }
function hasAdminPerms(member) { return isAdmin(member) || isOwner(member); }

/** Username parsers */
function getName(user) {
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

function getUniqueName(user) {
    user = user.user || user;
    if (user.discriminator && user.discriminator !== '0') {
        return `${user.username}#${user.discriminator}`;
    } else {
        return `@${user.username}`;
    }
}

/** Argument parsers */
const SNOWFLAKE = /^\d{17,19}$/;
const CHANNEL_MENTION = /^<#(?<id>\d{17,19})>$/;
const CHANNEL_LINK = /^https:\/\/(?:ptb\.|canary\.)?discord\.com\/channels\/\d{17,19}\/(?<id>\d{17,19})$/;
const USER_MENTION = /^<@!?(?<id>\d{17,19})>$/;
const MESSAGE_LINK = /^https:\/\/(?:ptb\.|canary\.)?discord\.com\/channels\/(?<guildID>\d{17,19})\/(?<channelID>\d{17,19})\/(?<messageID>\d{17,19})$/;

/**
 * @param {unknown} string 
 * @returns {string | undefined}
 */
function parseSnowflake(string) {
    if (typeof string !== 'string') return undefined;
    return string.match(SNOWFLAKE)?.[0];
}

/**
 * @param {unknown} string 
 * @returns {string | undefined}
 */
function parseChannelID(string) {
    if (typeof string !== 'string') return undefined;
    return string.match(CHANNEL_MENTION)?.groups?.id
        ?? string.match(CHANNEL_LINK)?.groups?.id
        ?? parseSnowflake(string);
}

/**
 * @param {unknown} string 
 * @returns {string | undefined}
 */
function parseUserID(string) {
    if (typeof string !== 'string') return undefined;
    return string.match(USER_MENTION)?.groups?.id
        ?? parseSnowflake(string);
}

/**
 * @param {unknown} string 
 * @returns {{guildID: string, channelID: string, messageID: string} | undefined}
 */
function parseMessageLink(string) {
    if (typeof string !== 'string') return undefined;
    return string.match(MESSAGE_LINK)?.groups;
}

/**
 * Parses next quoted argument from argument array
 * @param {string[]} args 
 * @param {string} delimiter defaults to `"`
 * @returns {[string | undefined, string[]]} [parsed string, rest of args]
 */
function parseQuoted(args, delimiter='"') {
    const FIRST = args[0];

    if (!FIRST || !FIRST.startsWith(delimiter)) return [undefined, args];

    const LAST_INDEX = args.findIndex((arg, index) => {
        if (!arg.endsWith(delimiter)) return false;
        if (index == 0) return arg.length >= delimiter.length * 2;
        return true;
    });

    if (LAST_INDEX == -1) return [undefined, args];

    return [args.slice(0, LAST_INDEX + 1).join(' ').slice(delimiter.length, -delimiter.length), args.slice(LAST_INDEX + 1)];
}

/** Misc */
async function downloadURL(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download content. Status code: ${response.statusCode}`));
                return;
            }

            const chunks = [];
            response.on('data', (chunk) => {
                chunks.push(chunk);
            });

            response.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve(buffer);
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

module.exports = {
    flattenRequireDir,
    hasRole,
    isHelper,
    isManager,
    isAdmin,
    isOwner,
    isStaff,
    hasHelperPerms,
    hasManagerPerms,
    hasAdminPerms,
    getName,
    getUniqueName,
    parseSnowflake,
    parseChannelID,
    parseUserID,
    parseMessageLink,
    parseQuoted,
    downloadURL
};