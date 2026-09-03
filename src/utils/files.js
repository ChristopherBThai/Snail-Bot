export function getTimestampForFilename() {
    return new Date().toISOString().replaceAll(':', '-');
}
