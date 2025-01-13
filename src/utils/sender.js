const axios = require('axios');

exports.ephemeralResponse = async (message, reply, timeout = 5000) => {
    let ephemeralMessage = await message.channel.createMessage(reply);
    setTimeout(() => {
        ephemeralMessage.delete();
    }, timeout);
    return ephemeralMessage;
};

exports.ephemeralInteractionResponse = (message) => {
    if (typeof message === 'string') {
        message = {
            content: message,
            flags: 64,
        };
    } else {
        message.flags = 64;
    }
    return message;
};

exports.owoCreateMessage = async (userId, message) => {
    await axios.post(`${process.env.OWO_URI}/msg-user/${userId}`, {
        password: process.env.OWO_PASSWORD,
        msg: message,
    });
};
