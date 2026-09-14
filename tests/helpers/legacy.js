// Execute the authoritative pre-refactor source offline, not a rewritten oracle.
// Requires the repository's historical Git object (no fetch/network is performed).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

export const BASELINE = 'd6a2ea4ccfc227bec7ab6146f66573d0aaf4c806';
export const namespace = '1b671a64-40d5-491e-99b0-da01ff1f3341';
export const plain = (value) => JSON.parse(JSON.stringify(value));

function uuidv5(key, namespace_) {
    const bytes = createHash('sha1')
        .update(Buffer.from(namespace_.replaceAll('-', ''), 'hex'))
        .update(key)
        .digest()
        .subarray(0, 16);
    bytes[6] = (bytes[6] & 15) | 80;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function loadLegacy(path, overrides = {}) {
    const source = execFileSync('git', ['show', `${BASELINE}:${path}`], { encoding: 'utf8' });
    const context = vm.createContext({
        module: { exports: {} },
        console: { log() {}, warn() {}, error() {} },
        process: { env: {} },
        Date,
        setTimeout,
        require(name) {
            if (name in overrides) return overrides[name];
            if (name === 'crypto') return { createHash };
            if (name === 'uuid') return { v5: uuidv5 };
            if (name === './Module')
                return class {
                    constructor(bot) {
                        this.bot = bot;
                    }
                    addEvent() {}
                };
            if (name === 'eris')
                return {
                    Constants: {
                        MessageTypes: { REPLY: 19 },
                        ChannelTypes: { GUILD_NEWS_THREAD: 10, GUILD_PUBLIC_THREAD: 11, GUILD_PRIVATE_THREAD: 12 },
                    },
                };
            if (name === '../utils/sender.js' || name === '../utils/kb.js') return {};
            if (name === './knowledge-base/AskConversation.js')
                return loadLegacy('src/modules/knowledge-base/AskConversation.js').exports;
            throw new Error(`Unexpected legacy dependency: ${name}`);
        },
    });
    vm.runInContext(source, context, { filename: `${BASELINE}/${path}` });
    return { exports: context.module.exports, evaluate: (expression) => vm.runInContext(expression, context), context };
}

export const legacyKB = loadLegacy('src/modules/KnowledgeBase.js');
export function legacyTag(tag) {
    return {
        _id: tag._id,
        data: tag.text,
        visibility: tag.public ? 'public' : 'kb_only',
        knowledgeBase: { excluded: tag.knowledgeBase?.excluded },
        kb: tag.knowledgeBase && {
            ...tag.knowledgeBase,
            dataHash: tag.knowledgeBase.textHash,
            promptVersion: typeof tag.knowledgeBase.generationHash === 'string' ? 'tag-question-v3' : undefined,
        },
    };
}

export function legacyPoints(tag, namespace_ = namespace) {
    const desired = legacyKB.evaluate('buildDesiredTagPoints')(legacyTag(tag), namespace_);
    return plain(
        [...desired.values()].map((item) => ({ id: item.pointId, payload: legacyKB.evaluate('buildPayload')(item) })),
    );
}
