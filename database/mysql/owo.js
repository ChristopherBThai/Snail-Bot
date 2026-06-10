const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    uri: process.env.OWO_MYSQL_URI,
    supportBigNumbers: true,
    multipleStatements: true,
    charset: 'utf8mb4',
    connectionLimit: 5,
});

module.exports = async function (sql, variables = []) {
    const [rows] = await pool.query(sql, variables);
    return rows;
};