const mongoose = require('mongoose');

let models = null;

/** @returns {Promise<Object<string, mongoose.Model>>} */
async function init() {
    if (models) return models;

    const connection = (await mongoose.connect(process.env.MONGO_URI)).connection;
    console.log(`MongoDB connected to ${connection.host}!`);

    connection.on('error', console.error);

    models = {
        Channel: connection.model('Channel', require('./schemas/Channel')),
        Config: connection.model('Config', require('./schemas/Config')),
        Tag: connection.model('Tag', require('./schemas/Tag'))
    };

    return models;
}

module.exports = { init };
