export const TERM_ID_MAX_LENGTH = 64;

export function normalizeTermId(value) {
    const termId = String(value ?? '')
        .trim()
        .toLowerCase();
    return termId.length <= TERM_ID_MAX_LENGTH && /^[a-z]+(?:_[a-z]+)*$/.test(termId) ? termId : undefined;
}

export function matchTerms(question, terms) {
    const normalized = String(question ?? '').toLowerCase();
    const matches = [];
    const occupied = [];

    for (const [id, meaning] of [...terms].toSorted(([left], [right]) => right.length - left.length)) {
        const phrase = id.replaceAll('_', ' ');
        const pattern = new RegExp(`\\b${escapeRegExp(phrase).replaceAll(' ', '\\s+')}\\b`, 'g');

        for (const match of normalized.matchAll(pattern)) {
            const start = match.index;
            const end = start + match[0].length;
            if (occupied.some((range) => start < range.end && end > range.start)) continue;
            occupied.push({ start, end });
            matches.push({ id, meaning });
            break;
        }
    }

    return matches;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
