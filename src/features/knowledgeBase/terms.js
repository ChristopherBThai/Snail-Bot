export const TERM_ID_MAX_LENGTH = 64;

export function normalizeTermId(value) {
    const termId = String(value ?? '')
        .trim()
        .toLowerCase();
    return termId.length <= TERM_ID_MAX_LENGTH && /^[a-z]+(?:_[a-z]+)*$/.test(termId) ? termId : undefined;
}

export function matchTerms(question, terms) {
    const tokens =
        String(question ?? '')
            .toLowerCase()
            .match(/[a-z0-9]+/g) ?? [];
    return [...new Set(tokens)].filter((id) => terms.has(id)).map((id) => ({ id, meaning: terms.get(id) }));
}
