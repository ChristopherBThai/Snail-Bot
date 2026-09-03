import 'dotenv/config';
import apm from 'elastic-apm-node';

const serverUrl = process.env.ELASTIC_AGENT_URL?.trim();
const enabled = Boolean(serverUrl);

if (enabled) {
    apm.start({
        serviceName: 'snail-bot',
        serverUrl,
        useElasticTraceparentHeader: true,
        transactionSampleRate: 1,
        environment: process.env.DEBUG ? 'development' : 'production',
        logLevel: 'off',
    });
}

export function createElasticApm(qdrantUrl) {
    let qdrant;
    try {
        qdrant = qdrantUrl ? new URL(qdrantUrl) : undefined;
    } catch {
        qdrant = undefined;
    }

    if (enabled && qdrant) {
        apm.addSpanFilter((payload) => {
            if (
                payload?.context?.destination?.address === qdrant.hostname &&
                payload.context.destination.port === Number(qdrant.port)
            ) {
                return JSON.parse(JSON.stringify(payload).replaceAll('localhost', 'qdrant'));
            }
            return payload;
        });
    }

    return {
        startTransaction(name, type) {
            return enabled ? apm.startTransaction(name, type) : undefined;
        },
        startSpan(name, type) {
            return enabled ? apm.startSpan(name, type) : undefined;
        },
        captureError(error) {
            if (enabled) apm.captureError(error);
        },
        get currentTransaction() {
            return enabled ? apm.currentTransaction : undefined;
        },
        setCustomContext(context) {
            if (enabled) apm.setCustomContext(context);
        },
    };
}
