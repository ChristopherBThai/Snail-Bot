export const LogLevels = Object.freeze({
    Trace: 'trace',
    Debug: 'debug',
    Info: 'info',
    Warn: 'warn',
    Error: 'error'
});

export const LogLevelWeights = Object.freeze({
    [LogLevels.Trace]: 0,
    [LogLevels.Debug]: 1,
    [LogLevels.Info]: 2,
    [LogLevels.Warn]: 3,
    [LogLevels.Error]: 4
});

export function createLogging({ levels = {}, limit }) {
    const entries = [];
    const sourceEntries = new Map();
    const sourceLevels = new Map(Object.entries(levels));

    return {
        createLogger,
        getEntries,
        getLevel,
        getSources,
        setLevel,
        setLevels
    };

    function createLogger({ console: printToConsole = false, context = {}, level = LogLevels.Info, sourceID }) {
        if (!sourceLevels.has(sourceID)) {
            setLevel(sourceID, level);
        }

        function makeLogger(boundContext) {
            return {
                child(context) {
                    return makeLogger({ ...boundContext, ...context });
                },
                debug(type, data = {}) {
                    return write(LogLevels.Debug, type, data, boundContext);
                },
                error(type, data = {}) {
                    return write(LogLevels.Error, type, data, boundContext);
                },
                get level() {
                    return getLevel(sourceID);
                },
                getEntries() {
                    return getSourceEntries(sourceID);
                },
                info(type, data = {}) {
                    return write(LogLevels.Info, type, data, boundContext);
                },
                setLevel(level) {
                    setLevel(sourceID, level);
                },
                time(type, data = {}) {
                    return createLogTimer(type, data, boundContext, write);
                },
                trace(type, data = {}) {
                    return write(LogLevels.Trace, type, data, boundContext);
                },
                warn(type, data = {}) {
                    return write(LogLevels.Warn, type, data, boundContext);
                }
            };
        }

        function write(level, type, data, boundContext) {
            validateLogLevel(level);
            if (LogLevelWeights[level] < LogLevelWeights[getLevel(sourceID)]) {
                return undefined;
            }

            const entry = add({
                time: new Date().toISOString(),
                sourceID,
                level,
                type,
                data: normalizeLogData(data, boundContext)
            });

            if (printToConsole) {
                const message = `[${entry.level}] ${entry.type}`;
                const details = Object.keys(entry.data).length ? entry.data : '';

                switch (entry.level) {
                    case LogLevels.Error:
                        console.error(message, details);
                        break;
                    case LogLevels.Warn:
                        console.warn(message, details);
                        break;
                    default:
                        console.info(message, details);
                }
            }

            return entry;
        }

        return makeLogger(context);
    }

    function add(entry) {
        const sourceRing = sourceEntries.get(entry.sourceID) ?? [];

        sourceEntries.set(entry.sourceID, sourceRing);
        pushRing(entries, entry, limit);
        pushRing(sourceRing, entry, limit);

        return entry;
    }

    function getSourceEntries(sourceID) {
        return [...(sourceEntries.get(sourceID) ?? [])];
    }

    function getEntries({ sourceID } = {}) {
        if (!sourceID) {
            return [...entries];
        }

        return getSourceEntries(sourceID);
    }

    function getLevel(sourceID) {
        return sourceLevels.get(sourceID) ?? LogLevels.Info;
    }

    function getSources() {
        const sourceIDs = new Set([...sourceEntries.keys(), ...sourceLevels.keys()]);

        return [...sourceIDs].sort().map((sourceID) => ({
            sourceID,
            level: getLevel(sourceID),
            logsLimit: limit,
            logsSize: getSourceEntries(sourceID).length
        }));
    }

    function setLevel(sourceID, level) {
        validateLogLevel(level);
        sourceLevels.set(sourceID, level);
    }

    function setLevels(levels) {
        for (const [sourceID, level] of Object.entries(levels)) {
            setLevel(sourceID, level);
        }
    }
}

function validateLogLevel(level) {
    if (LogLevelWeights[level] === undefined) {
        throw new Error(`Invalid log level "${level}".`);
    }
}

function createLogTimer(type, data, boundContext, write) {
    const start = performance.now();
    const duration = () => Math.round(performance.now() - start);

    return {
        end(extraData = {}, { level = LogLevels.Debug } = {}) {
            return write(level, type, { ...data, ...extraData, duration: duration() }, boundContext);
        },
        fail(error, extraData = {}) {
            return write(LogLevels.Error, type, { ...data, ...extraData, duration: duration(), error }, boundContext);
        }
    };
}

function normalizeLogData(data, context) {
    const normalizedData = data instanceof Error ? { error: data } : data;
    const mergedData = { ...context, ...normalizedData };

    if (mergedData.error instanceof Error) {
        return { ...mergedData, error: serializeError(mergedData.error) };
    }

    return mergedData;
}

function serializeError(error) {
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error.cause ? { cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause } : {}),
        ...Object.fromEntries(
            Object.entries(error).filter(([, value]) => ['boolean', 'number', 'string'].includes(typeof value))
        )
    };
}

function pushRing(entries, entry, limit) {
    if (entries.length >= limit) {
        entries.shift();
    }

    entries.push(entry);
}
