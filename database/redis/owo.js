const redis = require('redis');

/** @type {ReturnType<typeof redis.createClient> | null} */
let client = null;

async function init() {
    if (client) return client;

    client = redis.createClient({ url: process.env.OWO_REDIS_URI });
    client.on('error', console.error);

    await client.connect();
    console.log('OwO Redis connected!');

    return client;
}

module.exports = { init };
