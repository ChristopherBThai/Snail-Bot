const filter = new (require('bad-words'))();
const { roles: ROLES } = require("../config.json");

exports.hasRole = (member, role) => member?.roles.includes(role);
exports.isHelper = (member) => exports.hasRole(member, ROLES.helper);
exports.isModerator = (member) => exports.hasRole(member, ROLES.helper);
exports.isAdmin = (member) => exports.hasRole(member, ROLES.helper);
exports.isOwner = (member) => exports.hasRole(member, ROLES.helper);
exports.isStaff = (member) => exports.isHelper(member) || exports.isModerator(member) || exports.isAdmin(member) || exports.isOwner(member);

exports.removeBadWords = function (text) {
	return filter.clean(text);
};

exports.hasBenefit = function (benefit) {
	let diff = new Date() - benefit.started;
	diff = Math.floor(diff / 2592000000);
	return diff < benefit.months;
};
