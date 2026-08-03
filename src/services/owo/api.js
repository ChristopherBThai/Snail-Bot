/**
 * Creates the focused OwO API client used by Snail.
 *
 * @param {string} uri
 * @param {string} password
 */
export function createOwOAPI(uri, password) {
    const baseUri = uri.replace(/\/+$/, '');

    return {
        async sendMessage(userId, message) {
            const response = await fetch(`${baseUri}/msg-user/${userId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, msg: message }),
            });

            if (!response.ok) {
                throw new Error(`OwO API request failed: ${response.status} ${response.statusText}`);
            }
        },
    };
}
