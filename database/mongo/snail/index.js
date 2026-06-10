const mongoose = require('mongoose');

let models = null;

/** @returns {Promise<Object<string, mongoose.Model>>} */
async function init() {
    if (models) return models;

    const connection = await mongoose.createConnection(process.env.SNAIL_MONGO_URI).asPromise();
    console.log(`Snail MongoDB connected to ${connection.host}!`);

    connection.on('error', console.error);

    models = {
        Channel: connection.model('Channel', require('./schemas/Channel')),
        Config: connection.model('Config', require('./schemas/Config')),
        Quest: connection.model('Quest', require('./schemas/Quest')),
        Tag: connection.model('Tag', require('./schemas/Tag'))
    };

    return models;
}

module.exports = { init };
