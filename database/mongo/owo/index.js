const mongoose = require('mongoose');

let models = null;

/** @returns {Promise<Object<string, mongoose.Model>>} */
async function init() {
    if (models) return models;

    const connection = await mongoose.createConnection(process.env.OWO_MONGO_URI).asPromise();
    console.log(`OwO MongoDB connected to ${connection.host}!`);

    connection.on('error', console.error);

    models = {
        UserQuest: connection.model('UserQuest', require('./schemas/UserQuest')),
        UserQuestBoard: connection.model('UserQuestBoard', require('./schemas/UserQuestBoard'))
    };

    return models;
}

module.exports = { init };
