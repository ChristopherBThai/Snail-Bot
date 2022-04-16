const mysql = require('mysql');

const config = {
	host: process.env.OWO_MYSQL_URI,
	user: process.env.OWO_MYSQL_USER,
	password: process.env.OWO_MYSQL_PASS,
	database: 'owo',
	supportBigNumbers: true,
	multipleStatements: true,
	charset: 'utf8mb4',
	connectionLimit: 5
};

const pool = mysql.createPool(config);

exports.query = function (sql, variables = []) {
	return new Promise((resolve, reject) => {
		pool.query(sql, variables, (err, rows) => {
			if (err) return reject(err);
			resolve(rows);
		})
	});
}
