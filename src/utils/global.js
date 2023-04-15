const { roles: ROLES } = require("../config.json");

exports.hasRole = (member, role) => member?.roles.includes(role);

exports.isHelper = (member) => exports.hasRole(member, ROLES.helper);
exports.isModerator = (member) => exports.hasRole(member, ROLES.mod);
exports.isAdmin = (member) => exports.hasRole(member, ROLES.admin);
exports.isOwner = (member) => exports.hasRole(member, ROLES.owner);
exports.isStaff = (member) => exports.isHelper(member) || exports.isModerator(member) || exports.isAdmin(member) || exports.isOwner(member);

exports.hasHelperPerms = (member) => exports.isStaff(member);
exports.hasModeratorPerms = (member) => exports.isModerator(member) || exports.isAdmin(member) || exports.isOwner(member);
exports.hasAdminPerms = (member) => exports.isAdmin(member) || exports.isOwner(member);

exports.warn = async (msg, text, timeout = 5000) => {
    let warnMsg = await msg.channel.createMessage(`🚫 **| ${msg.author.username}**, ${text}`);
    setTimeout(() => {
        warnMsg.delete();
    }, timeout);
    return warnMsg;
}