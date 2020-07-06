const slowmode = 30;

exports.handle = async function(other, oldPresence) {
  if (other.user.id == this.config["owo-bot"]) {
    if (other.status == "online") {
      // Bot is online, revert server to normal mode
      console.log("Bot is back online!");
      await setLimit.bind(this)(0, `Bot is online! Removing slowmode!`);
    } else {
      // Bot is offline, make server go into slowmode
      console.log("Bot is offline!");
      await setLimit.bind(this)(30, `Bot is offline! Setting slowmode to ${slowmode} seconds!`);
    }
  }
}

async function setLimit(timer, text) {
  for (let i in this.config.watchChannels) {
    let channelID = this.config.watchChannels[i];
    let guildID = this.channelGuildMap[channelID];
    if (!guildID) throw new Error("Invalid channel id in watchlist");
    let guild = this.guilds.get(guildID)
    let channel = guild.channels.get(channelID);

    await channel.createMessage(text);
    await channel.edit({
      rateLimitPerUser: timer
    });
  }
}
