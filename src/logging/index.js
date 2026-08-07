import { serializeLogRecord } from './export.js';

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
const LOG_BYTE_LIMIT = 10 * 1_024 * 1_024;
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
 * @property {number} byteLimit Maximum serialized size of retained records.
 * @property {number} bytes Serialized size of retained records.
 * @property {number} size Number of currently retained records.
 * @property {ReadonlyArray<Log>} logs Snapshot of retained records in chronological order.
 * @property {(message: string, data?: unknown) => void} trace Writes a trace record.
 * @property {(message: string, data?: unknown) => void} debug Writes a debug record.
 * @property {(message: string, data?: unknown) => void} info Writes an info record.
 * @property {(message: string, data?: unknown) => void} warn Writes a warning record.
 * @property {(message: string, data?: unknown) => void} error Writes an error record.
 * @property {() => LogTimer} time Creates a timer for one completed log record.
 * @property {() => void} clear
 */

/**
 * A timer that adds sequential checkpoint durations and total duration to one log record.
 *
 * @typedef {object} LogTimer
 * @property {(name: string) => void} checkpoint Records the time since the previous checkpoint.
 * @property {(message: string, data?: Record<string, unknown>) => void} trace Writes a timed trace record.
 * @property {(message: string, data?: Record<string, unknown>) => void} debug Writes a timed debug record.
 * @property {(message: string, data?: Record<string, unknown>) => void} info Writes a timed info record.
 * @property {(message: string, data?: Record<string, unknown>) => void} warn Writes a timed warning record.
 * @property {(message: string, data?: Record<string, unknown>) => void} error Writes a timed error record.
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

        const entries = [];
        let firstEntry = 0;
        let retainedBytes = 2;

        const logger = {
            name,

            get logs() {
                return entries.slice(firstEntry).map((entry) => entry.log);
            },

            get level() {
                return configuredLevels.get(name) ?? DEFAULT_LEVEL;
            },

            get byteLimit() {
                return LOG_BYTE_LIMIT;
            },

            get bytes() {
                return retainedBytes;
            },

            get size() {
                return entries.length - firstEntry;
            },

            /**
             * Creates a timer for sequential checkpoints and one completed log record.
             *
             * @returns {LogTimer}
             */
            time() {
                const startedAt = performance.now();
                let previousAt = startedAt;
                let completed = false;
                const checkpoints = {};
                const timer = {
                    checkpoint(checkpointName) {
                        if (completed) throw new Error('Log timer has already completed');

                        const now = performance.now();
                        checkpoints[`${checkpointName}Ms`] = Math.round(now - previousAt);
                        previousAt = now;
                    },
                };

                for (const logLevel of Object.keys(LEVELS)) {
                    timer[logLevel] = (message, data) => {
                        if (completed) throw new Error('Log timer has already completed');
                        completed = true;
                        write(logLevel, message, {
                            ...data,
                            ...checkpoints,
                            durationMs: Math.round(performance.now() - startedAt),
                        });
                    };
                }

                return timer;
            },

            /**
             * Removes every retained record without changing the logger's configuration.
             */
            clear() {
                entries.length = 0;
                firstEntry = 0;
                retainedBytes = 2;
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

            const bytes = Buffer.byteLength(serializeLogRecord(log));
            entries.push({ log, bytes });
            retainedBytes += bytes + 2;

            while (retainedBytes > LOG_BYTE_LIMIT) {
                retainedBytes -= entries[firstEntry].bytes + 2;
                firstEntry += 1;
            }

            if (firstEntry * 2 >= entries.length) {
                entries.splice(0, firstEntry);
                firstEntry = 0;
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
