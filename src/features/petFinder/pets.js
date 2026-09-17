export const STATS = Object.freeze(['hp', 'att', 'pr', 'wp', 'mag', 'mr']);
const CATALOG_SQL = "SELECT name, SUBSTRING_INDEX(alt, ',', 1) AS alias, hp, wp, att, mag, pr, mr FROM animals";
const levelThresholds = [0n];

/** Owns the shared pet catalog and reads each panel's current inventory. */
export function createPetSource({ mysql, log, timeZone }) {
    let catalog;
    let loading;
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return { activate, loadPets };

    async function reload() {
        loading ??= mysql.query(CATALOG_SQL).then(([rows]) => {
            catalog = new Map(rows.map((row) => [row.name, row]));
            log.info('Loaded pet cache', { petCount: catalog.size });
        });
        try {
            await loading;
        } finally {
            loading = undefined;
        }
    }

    async function activate() {
        let delay;
        try {
            await reload();
            // Find the next local 00:05, including days shortened or lengthened by DST.
            let next = Math.floor(Date.now() / 60_000) * 60_000 + 60_000;
            while (clock.format(next) !== '00:05') next += 60_000;
            delay = next - Date.now();
        } catch (error) {
            log.warn('Could not refresh pet catalog; retrying in one minute', { error });
            delay = 60_000;
        }
        setTimeout(activate, delay);
    }

    // A null userId searches the catalog without reading an inventory.
    async function loadPets(userId, { filters, sort }) {
        if (!catalog) await reload();
        const [rows] =
            userId === null
                ? [[...catalog.values()]]
                : await mysql.execute(
                      'SELECT name, CAST(xp_bigint AS CHAR) AS xp FROM animal WHERE id = ? AND totalcount >= 1',
                      [userId],
                  );
        // A midnight reload can replace the map while this panel resolves missing pets.
        // Keep those lookups in this snapshot rather than overwriting the new catalog.
        const snapshot = catalog;
        const missing = [...new Set(rows.map((pet) => pet.name))].filter((name) => !snapshot.has(name));
        if (missing.length) {
            const [rows] = await mysql.execute(
                `${CATALOG_SQL} WHERE name IN (${missing.map(() => '?').join(',')})`,
                missing,
            );
            for (const row of rows) snapshot.set(row.name, row);
        }
        const pets = [];
        for (const row of rows) {
            const definition = snapshot.get(row.name);
            if (!definition) continue;
            const stats = Object.fromEntries(STATS.map((stat) => [stat, Number(definition[stat])]));
            if (STATS.some((stat) => definition[stat] == null || !Number.isFinite(stats[stat]))) continue;
            pets.push({ name: row.name, alias: definition.alias || row.name, ...stats, level: getPetLevel(row.xp) });
        }
        return { pets: matchingPets(pets, filters, sort), total: rows.length, omitted: rows.length - pets.length };
    }
}

function getPetLevel(value) {
    if (!/^\d{1,20}$/.test(value)) return undefined;
    const xp = BigInt(value);
    if (xp > (1n << 64n) - 1n) return undefined;
    while (levelThresholds.at(-1) <= xp) {
        levelThresholds.push(levelThresholds.at(-1) + BigInt(levelThresholds.length) ** 4n + 1000n);
    }
    let low = 0;
    let high = levelThresholds.length - 1;
    while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (levelThresholds[middle] <= xp) low = middle;
        else high = middle;
    }
    return low + 1;
}

function matchingPets(pets, filters, sort) {
    const ranges = Object.entries(filters);
    const [key, direction] = sort.split('.');
    return pets
        .filter((pet) =>
            ranges.every(
                ([stat, { min, max }]) =>
                    (min === undefined || pet[stat] >= min) && (max === undefined || pet[stat] <= max),
            ),
        )
        .sort((a, b) => {
            const names = () => a.alias.localeCompare(b.alias) || a.name.localeCompare(b.name);
            if (key === 'name') return names();
            if (a[key] === undefined) return b[key] === undefined ? names() : 1;
            if (b[key] === undefined) return -1;
            return (a[key] - b[key]) * (direction === 'desc' ? -1 : 1) || names();
        });
}
