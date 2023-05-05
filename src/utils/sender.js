exports.ephemeralReply = async (message, reply, timeout = 5000) => {
    let ephemeralMessage = await message.channel.createMessage(reply);
    setTimeout(() => { ephemeralMessage.delete(); }, timeout);
    return ephemeralMessage;
}