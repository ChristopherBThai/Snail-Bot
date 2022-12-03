const filter = new (require('bad-words'))();

exports.hasRoles = function (member, roles) {
	if (!member) return false;
	for (let role of roles) {
		if (member.roles.find((ele) => ele == role)) {
			return true;
		}
	}
	return false;
};

exports.removeBadWords = function (text) {
	return filter.clean(text);
};

exports.hasBenefit = function (benefit) {
	let diff = new Date() - benefit.started;
	diff = Math.floor(diff / 2592000000);
	return diff < benefit.months;
};
