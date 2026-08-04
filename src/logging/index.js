/**
 * A retained log severity, ordered from `trace` through `error`.
 *
 * @typedef {'trace' | 'debug' | 'info' | 'warn' | 'error'} LogLevel
 */

const LEVELS = Object.freeze({
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
});

export const LOG_LEVELS = Object.freeze(Object.keys(LEVELS));

const DEFAULT_LEVEL = 'info';
const LOG_LIMIT = 2_500;
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
});

/**
 * A retained log record.
 *
 * @typedef {object} Log
 * @property {number} timestamp Unix timestamp in milliseconds.
 * @property {LogLevel} level Severity at which the record was written.
 * @property {string} message Human-readable description of the event.
 * @property {unknown} [data] Structured details relevant to the event.
 */

/**
 * A named logger that retains log records.
 *
 * Records below `level` are discarded.
 *
 * @typedef {object} Logger
 * @property {string} name Unique logger name.
 * @property {LogLevel} level Minimum retained level.
 * @property {number} limit Maximum number of retained records.
 * @property {number} size Number of currently retained records.
 * @property {ReadonlyArray<Log>} logs Snapshot of retained records in chronological order.
 * @property {(message: string, data?: unknown) => void} trace Writes a trace record.
 * @property {(message: string, data?: unknown) => void} debug Writes a debug record.
 * @property {(message: string, data?: unknown) => void} info Writes an info record.
 * @property {(message: string, data?: unknown) => void} warn Writes a warning record.
 * @property {(message: string, data?: unknown) => void} error Writes an error record.
 * @property {() => void} clear
 */

/**
 * Creates an isolated Snail logging manager.
 */
export function createLogging() {
    const loggers = new Map();
    const configuredLevels = new Map();

    return {
        createLogger,
        getLoggers,
        setLevel,
    };

    /**
     * Creates and registers a uniquely named logger.
     *
     * @param {string} name Unique logger name.
     * @param {boolean} [print=false] Whether retained records should also be printed to the console.
     * @returns {Logger}
     * @throws {Error} If a logger with `name` is already registered.
     */
    function createLogger(name, print = false) {
        if (loggers.has(name)) {
            throw new Error(`Logger already exists: ${name}`);
        }

        const logs = [];

        const logger = {
            name,

            get logs() {
                return [...logs];
            },

            get level() {
                return configuredLevels.get(name) ?? DEFAULT_LEVEL;
            },

            get limit() {
                return LOG_LIMIT;
            },

            get size() {
                return logs.length;
            },

            /**
             * Removes every retained record without changing the logger's configuration.
             */
            clear() {
                logs.length = 0;
            },
        };

        function write(logLevel, message, data) {
            if (LEVELS[logLevel] < LEVELS[logger.level]) return;

            const log = {
                timestamp: Date.now(),
                level: logLevel,
                message,
                ...(data === undefined ? {} : { data }),
            };

            logs.push(log);

            if (logs.length > LOG_LIMIT) {
                logs.shift();
            }

            if (print) {
                const time = TIME_FORMAT.format(log.timestamp);
                const level = log.level.toUpperCase();
                const line = `[${level}] [${time}] [${logger.name}] ${log.message}`;

                if (log.data === undefined) {
                    console.log(line);
                } else {
                    console.log(line, log.data);
                }
            }
        }

        for (const logLevel of Object.keys(LEVELS)) {
            logger[logLevel] = (message, data) => write(logLevel, message, data);
        }

        loggers.set(name, logger);

        return logger;
    }

    /**
     * Returns the registered loggers in creation order.
     *
     * The array is a snapshot of the registry. Its logger objects remain live.
     *
     * @returns {Logger[]}
     */
    function getLoggers() {
        return [...loggers.values()];
    }

    /**
     * Sets the minimum retained level for a logger name.
     *
     * The setting also applies if the logger is created later.
     *
     * @param {string} name
     * @param {LogLevel} level
     * @throws {TypeError} If `level` is not recognized.
     */
    function setLevel(name, level) {
        if (!Object.hasOwn(LEVELS, level)) {
            throw new TypeError(`Unknown log level: ${level}`);
        }

        configuredLevels.set(name, level);
    }
}
