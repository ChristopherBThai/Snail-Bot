import mongoose from 'mongoose';

export function createTicketMarketData(databases) {
    const TicketMarketAd = createTicketMarketAdModel(databases.snail.mongo.connection);
    const users = databases.snail.mongo.User;
    const owoMySQLPool = databases.owo.mysql.pool;

    return {
        async getUser(userID) {
            return await users.findById(userID).lean();
        },

        async hasMarketAgreement(userID) {
            return Boolean(
                await users.exists({
                    _id: userID,
                    'ticketMarket.marketAgreedAt': { $exists: true, $ne: null },
                    'ticketMarket.marketBannedAt': null
                })
            );
        },

        async hasSellerAgreement(userID) {
            return Boolean(
                await users.exists({
                    _id: userID,
                    'ticketMarket.sellerAgreedAt': { $exists: true, $ne: null },
                    'ticketMarket.marketBannedAt': null
                })
            );
        },

        async isMarketBanned(userID) {
            return Boolean(
                await users.exists({
                    _id: userID,
                    'ticketMarket.marketBannedAt': { $exists: true, $ne: null }
                })
            );
        },

        async saveMarketAgreement(userID, agreedAt) {
            await users.updateOne(
                { _id: userID },
                {
                    $set: {
                        'ticketMarket.marketAgreedAt': agreedAt
                    },
                    $setOnInsert: { _id: userID }
                },
                { upsert: true }
            );
        },

        async saveSellerAgreement(userID, agreedAt) {
            await users.updateOne(
                { _id: userID },
                {
                    $set: {
                        'ticketMarket.sellerAgreedAt': agreedAt
                    },
                    $setOnInsert: { _id: userID }
                },
                { upsert: true }
            );
        },

        async countSellerAgreements() {
            return await users.countDocuments({ 'ticketMarket.sellerAgreedAt': { $exists: true, $ne: null } });
        },

        async createUserLog(log) {
            return await databases.snail.mongo.UserLog.create({
                ...log,
                source: 'ticket_market',
                createdAt: log.createdAt ?? new Date()
            });
        },

        async loadActiveAds() {
            return await TicketMarketAd.find({ deletedAt: { $exists: false } })
                .sort({ postedAt: 1 })
                .lean();
        },

        async getActiveAdBySeller(userID) {
            return await TicketMarketAd.findOne({ sellerID: userID, deletedAt: { $exists: false } }).lean();
        },

        async getActiveAdByMessageID(messageID) {
            return await TicketMarketAd.findOne({ messageID, deletedAt: { $exists: false } }).lean();
        },

        async getLastAdBySeller(userID) {
            return await TicketMarketAd.findOne({ sellerID: userID }).sort({ postedAt: -1 }).lean();
        },

        async createAd(ad) {
            return await TicketMarketAd.create(ad);
        },

        async endAdByMessageID(messageID, { deletedAt, deletedBy }) {
            return await TicketMarketAd.findOneAndUpdate(
                { messageID, deletedAt: { $exists: false } },
                { $set: { deletedAt, deletedBy } },
                { returnDocument: 'after' }
            ).lean();
        },

        async resetAvailability(messageID, availableUntil) {
            return await TicketMarketAd.findOneAndUpdate(
                { messageID, deletedAt: { $exists: false } },
                { $set: { availableUntil } },
                { returnDocument: 'after' }
            ).lean();
        },

        async getWrappedTicketCountByDiscordID(userID) {
            const [rows] = await owoMySQLPool.execute(
                `SELECT COALESCE(ui.count, 0) AS wrapped_ticket_count
FROM user u
LEFT JOIN user_item ui
    ON ui.uid = u.uid
    AND ui.name = 'common_tickets'
WHERE u.id = ?`,
                [userID]
            );

            return Number(rows[0]?.wrapped_ticket_count ?? 0);
        }
    };
}

function createTicketMarketAdModel(connection) {
    if (connection.models.TicketMarketAd) {
        return connection.models.TicketMarketAd;
    }

    const schema = new mongoose.Schema({
        sellerID: { type: String, required: true },
        messageID: { type: String, required: true },
        tickets: { type: Number, required: true },
        price: { type: Number, required: true },
        note: String,
        postedAt: { type: Number, required: true },
        deletedAt: Number,
        deletedBy: String,
        availableUntil: Number
    });

    schema.index({ messageID: 1 }, { unique: true });
    schema.index(
        { sellerID: 1, deletedAt: 1 },
        {
            partialFilterExpression: { deletedAt: { $exists: false } }
        }
    );

    return connection.model('TicketMarketAd', schema);
}
