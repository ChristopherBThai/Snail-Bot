const { roles: ROLES } = require("../config.json");

exports.hasRole = (member, role) => member?.roles.includes(role);
exports.isHelper = (member) => exports.hasRole(member, ROLES.helper);
exports.isModerator = (member) => exports.hasRole(member, ROLES.mod);
exports.isAdmin = (member) => exports.hasRole(member, ROLES.admin);
exports.isOwner = (member) => exports.hasRole(member, ROLES.owner);
exports.isStaff = (member) => exports.isHelper(member) || exports.isModerator(member) || exports.isAdmin(member) || exports.isOwner(member);