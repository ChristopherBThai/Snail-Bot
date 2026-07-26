const apm = require('elastic-apm-node');

module.exports = class ElasticApm extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'elasticapm',
            name: 'Elastic APM',
            description: 'Captures Elastic APM for elk',
            toggleable: true,
        });

        this.agent = apm;
        this.initAgent();
    }

    get qdrantUrl() {
        return this.bot.modules.knowledgebase?.qdrantUrl || null;
    }

    initAgent() {
        this.agent.handleUncaughtExceptions((err) => {
            this.captureError(err);
        });

        // Rename localhost qdrant spans to qdrant for better visibility in APM
        this.agent.addSpanFilter((payload) => {
            if (payload?.context?.destination?.address) {
                const address = payload.context.destination.address;
                const port = payload.context.destination.port;
                const qdrantUrl = new URL(this.qdrantUrl);
                if (address === qdrantUrl.hostname && port === parseInt(qdrantUrl.port)) {
                    const payloadString = JSON.stringify(payload);
                    payloadString.replaceAll('localhost', 'qdrant');
                    payload = JSON.parse(payloadString);
                }
            }
            return payload;
        });
    }

    startTransaction(name, type) {
        if (!this.enabled) return;
        return this.agent.startTransaction(name, type);
    }

    startSpan(name, type) {
        if (!this.enabled) return;
        return this.agent.startSpan(name, type);
    }

    captureError(err) {
        if (!this.enabled) return;
        this.agent.captureError(err);
    }

    get currentTransaction() {
        if (!this.enabled) return null;
        return this.agent.currentTransaction;
    }

    get currentSpan() {
        if (!this.enabled) return null;
        return this.agent.currentSpan;
    }

    get apm() {
        if (!this.enabled) return null;
        return this.agent;
    }

    getConfigurationOverview() {
        return (
            `- Toggleable: ${this.toggleable}\n` +
            `- Enabled: ${this.enabled}\n` +
            `- Server URL configured: ${Boolean(process.env.ELASTIC_AGENT_URL)}\n` +
            `- Sample rate: 1.0`
        );
    }
};
