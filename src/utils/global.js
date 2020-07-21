exports.hasRoles = function (member, roles) {
	for (let role of roles) {
		if (member.roles.find(ele => ele == role)) {
			return true;
		}
	}
	return false;
}
