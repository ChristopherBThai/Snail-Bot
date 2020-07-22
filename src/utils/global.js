exports.hasRoles = function (member, roles) {
	for (let role of roles) {
		if (member.roles.find(ele => ele == role)) {
			return true;
		}
	}
	return false;
}

exports.removeBadWords = function (text) {
	return text;
}

exports.hasBenefit = function(benefit) {
	let diff = new Date() - benefit.started;
	diff = Math.floor(diff / 2592000000);
	return diff < benefit.months;
}
