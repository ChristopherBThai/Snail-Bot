export function serializeLoggerLogs(logger, maxBytes) {
    return serializeRecentLogs(logger.logs, maxBytes);
}

export function serializeLogs(loggers, maxBytes) {
    const logs = loggers
        .flatMap((logger) => logger.logs.map((log) => ({ logger: logger.name, ...log })))
        .sort((a, b) => a.timestamp - b.timestamp);

    return serializeRecentLogs(logs, maxBytes);
}

function serializeRecentLogs(logs, maxBytes) {
    const selected = [];
    let bytes = 4;

    for (let index = logs.length - 1; index >= 0; index -= 1) {
        const serialized = serializeLogRecord(logs[index]);
        const nextBytes = Buffer.byteLength(serialized) + (selected.length ? 2 : 0);
        if (bytes + nextBytes > maxBytes) break;

        selected.push(serialized);
        bytes += nextBytes;
    }

    selected.reverse();

    const data = selected.length ? `[\n${selected.join(',\n')}\n]` : '[]';

    return {
        data,
        bytes: Buffer.byteLength(data),
        exported: selected.length,
        total: logs.length,
    };
}

export function serializeLogRecord(log) {
    return JSON.stringify(log, serializeLogValue, 4)
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
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
