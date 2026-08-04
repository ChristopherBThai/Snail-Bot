const LEVEL_PREFIX = 'logging:level:';

export async function loadLoggingLevels(Setting) {
    const settings = await Setting.find({ _id: { $regex: `^${LEVEL_PREFIX}` } }).lean();

    return Object.fromEntries(settings.map((setting) => [setting._id.slice(LEVEL_PREFIX.length), setting.value]));
}

export async function saveLoggingLevel(Setting, loggerName, level) {
    await Setting.updateOne({ _id: `${LEVEL_PREFIX}${loggerName}` }, { $set: { value: level } }, { upsert: true });
}
