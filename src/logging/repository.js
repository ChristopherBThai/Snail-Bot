const LEVEL_NAMESPACE = 'logging:level';

export async function loadLoggingLevels(Setting) {
    return Setting.loadValues(LEVEL_NAMESPACE);
}

export async function saveLoggingLevel(Setting, loggerName, level) {
    await Setting.saveValue(LEVEL_NAMESPACE, loggerName, level);
}
