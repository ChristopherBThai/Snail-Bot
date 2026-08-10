const SUPPORTER_QUERY = (placeholders) => `
    WITH target AS (
        SELECT id AS userId, uid
        FROM \`user\`
        WHERE id IN (${placeholders})
    )
    SELECT
        t.userId,
        'ticket' AS source,
        p.patreonType AS benefitRank,
        p.patreonTimer AS startTime,
        p.patreonMonths AS calendarMonths,
        NULL AS endTime
    FROM target t
    JOIN patreons p ON p.uid = t.uid

    UNION ALL

    SELECT
        t.userId,
        'patreon' AS source,
        pw.patreonType AS benefitRank,
        NULL AS startTime,
        NULL AS calendarMonths,
        pw.endDate AS endTime
    FROM target t
    JOIN patreon_wh pw ON pw.uid = t.uid

    UNION ALL

    SELECT
        t.userId,
        'discord' AS source,
        pd.patreonType AS benefitRank,
        NULL AS startTime,
        NULL AS calendarMonths,
        pd.endDate AS endTime
    FROM target t
    JOIN patreon_discord pd ON pd.uid = t.uid
`;

const USER_ID_PROJECTION = { _id: 1 };

export function createSupporterRolesRepository({ mysql, User }) {
    return {
        async getPerks(userIds) {
            const perksByUserId = new Map(userIds.map((userId) => [userId, createPerks()]));
            if (!userIds.length) return perksByUserId;

            const placeholders = userIds.map(() => '?').join(', ');
            const [rows] = await mysql.execute(SUPPORTER_QUERY(placeholders), userIds);
            normalizePerks(rows, perksByUserId);
            return perksByUserId;
        },

        async getOptedOutUserIds() {
            const users = await User.find({ 'supporterRoles.optout': true }, USER_ID_PROJECTION).lean();
            return users.map((user) => user._id);
        },

        async setOptedOut(userId, optedOut) {
            await User.updateOne({ _id: userId }, { $set: { 'supporterRoles.optout': optedOut } }, { upsert: true });
        },
    };
}

function normalizePerks(rows, perksByUserId) {
    const now = Date.now();

    for (const row of rows) {
        const rank = Number(row.benefitRank);
        const expiration = getExpiration(row);
        if (!rank || expiration.getTime() <= now) continue;

        const perk = perksByUserId.get(String(row.userId))[row.source];
        if (rank < perk.rank || (rank === perk.rank && perk.expiration >= expiration)) continue;
        perk.rank = rank;
        perk.expiration = expiration;
    }
}

function createPerks() {
    return {
        ticket: createPerk(),
        patreon: createPerk(),
        discord: createPerk(),
    };
}

function createPerk() {
    return {
        rank: 0,
        expiration: undefined,
    };
}

function getExpiration(row) {
    const expiration = new Date(row.startTime ?? row.endTime);
    if (row.source === 'ticket') expiration.setMonth(expiration.getMonth() + Number(row.calendarMonths));
    return expiration;
}
