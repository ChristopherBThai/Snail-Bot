/**
 * Adapts a Snail logger to Discordeno's variadic logger interface.
 *
 * Discordeno `fatal` records are retained as Snail `error` records.
 */
export function createDiscordenoLogger(logger) {
    function adapt(method) {
        return (...args) => {
            const [message, ...details] = args;

            if (message instanceof Error) {
                method(message.message, {
                    error: message,
                    ...(details.length === 0 ? {} : { details }),
                });
                return;
            }

            if (details.length === 1 && details[0] instanceof Error) {
                method(message, { error: details[0] });
                return;
            }

            method(message, details.length > 1 ? details : details[0]);
        };
    }

    return {
        debug: adapt(logger.debug),
        info: adapt(logger.info),
        warn: adapt(logger.warn),
        error: adapt(logger.error),
        fatal: adapt(logger.error),
    };
}
