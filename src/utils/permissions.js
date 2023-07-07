const { roles, debug } = require("../../config.json");

exports.hasRole = (member, role) => member?.roles.includes(role);

exports.isHelper = (member) => exports.hasRole(member, roles.helper);
exports.isManager = (member) => exports.hasRole(member, roles.manager);
exports.isAdmin = (member) => exports.hasRole(member, roles.admin);
exports.isOwner = (member) => exports.hasRole(member, roles.owner) || (debug && (member.id == "210177401064390658"));
exports.isStaff = (member) => exports.isHelper(member) || exports.isManager(member) || exports.isAdmin(member) || exports.isOwner(member);

exports.hasHelperPerms = (member) => exports.isStaff(member);
exports.hasManagerPerms = (member) => exports.isManager(member) || exports.isAdmin(member) || exports.isOwner(member);
exports.hasAdminPerms = (member) => exports.isAdmin(member) || exports.isOwner(member);