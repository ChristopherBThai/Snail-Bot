export function serializeLoggerLogs(logger) {
    return JSON.stringify(logger.logs, serializeLogValue, 4);
}

export function serializeLogs(loggers) {
    const logs = loggers
        .flatMap((logger) => logger.logs.map((log) => ({ logger: logger.name, ...log })))
        .sort((a, b) => a.timestamp - b.timestamp);

    return JSON.stringify(logs, serializeLogValue, 4);
}

function serializeLogValue(_key, value) {
    if (typeof value === 'bigint') return value.toString();
    if (!(value instanceof Error)) return value;

    const details = Object.fromEntries(
        Object.entries(value).filter(
            ([key, detail]) =>
                !['name', 'message', 'stack', 'cause'].includes(key) &&
                ['boolean', 'number', 'string'].includes(typeof detail),
        ),
    );

    return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        ...(value.cause === undefined ? {} : { cause: value.cause }),
        ...details,
    };
}
