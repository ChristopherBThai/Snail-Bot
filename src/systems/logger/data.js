const LogLevelConfigPrefix = 'logging_level_';

export async function loadLogLevels(databases) {
    const docs = await databases.snail.mongo.Config.find({
        _id: { $regex: `^${LogLevelConfigPrefix}` }
    }).lean();

    return Object.fromEntries(docs.map((doc) => [doc._id.slice(LogLevelConfigPrefix.length), doc.value]));
}

export async function saveLogLevel(databases, sourceID, level) {
    await databases.snail.mongo.Config.updateOne(
        { _id: `${LogLevelConfigPrefix}${sourceID}` },
        { $set: { value: level } },
        { upsert: true }
    );
}
