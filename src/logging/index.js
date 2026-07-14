export function createLogger({ source = 'snail', sink = console } = {}) {
    return Object.freeze({
        debug(message, fields) {
            sink.debug(formatLogMessage(source, message), fields ?? {});
        },
        info(message, fields) {
            sink.info(formatLogMessage(source, message), fields ?? {});
        },
        warn(message, fields) {
            sink.warn(formatLogMessage(source, message), fields ?? {});
        },
        error(message, fields) {
            sink.error(formatLogMessage(source, message), fields ?? {});
        },
        child(childSource) {
            return createLogger({ source: `${source}.${childSource}`, sink });
        }
    });
}

function formatLogMessage(source, message) {
    return `[${source}] ${message}`;
}
