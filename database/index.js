async function init() {
    const snailMongo = await require('./mongo/snail').init();
    const owoMongo = await require('./mongo/owo').init();
    const owoRedis = await require('./redis/owo').init();
    const owoMysql = require('./mysql/owo');

    return {
        snailMongo,
        owoMongo,
        owoRedis,
        owoMysql
    };
}

module.exports = { init };
