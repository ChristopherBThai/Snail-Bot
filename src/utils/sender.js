exports.ephemeralResponse = async (channel, reply, timeout = 5000) => {
    let ephemeralMessage = await channel.createMessage(reply);
    setTimeout(() => {
        ephemeralMessage.delete();
    }, timeout);
    return ephemeralMessage;
};
