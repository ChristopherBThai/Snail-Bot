const { roles, debug } = require("../config.json");

exports.hasRole = (member, role) => member?.roles.includes(role);

exports.isHelper = (member) => exports.hasRole(member, roles.helper);
exports.isModerator = (member) => exports.hasRole(member, roles.mod);
exports.isAdmin = (member) => exports.hasRole(member, roles.admin);
exports.isOwner = (member) => exports.hasRole(member, roles.owner) || (debug && (member.id == "210177401064390658"));
exports.isStaff = (member) => exports.isHelper(member) || exports.isModerator(member) || exports.isAdmin(member) || exports.isOwner(member);

exports.hasHelperPerms = (member) => exports.isStaff(member);
exports.hasModeratorPerms = (member) => exports.isModerator(member) || exports.isAdmin(member) || exports.isOwner(member);
exports.hasAdminPerms = (member) => exports.isAdmin(member) || exports.isOwner(member);