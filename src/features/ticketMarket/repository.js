const SETTING_NAMESPACE = 'ticketMarket';
const ACTIVE_AD_PROJECTION = {
    _id: 1,
    'ticketMarket.activeAd': 1,
};
const LAST_AD_POSTED_AT_PROJECTION = {
    'ticketMarket.lastAdPostedAt': 1,
};

export function createTicketMarketRepository({ Setting, User, mysql }) {
    return {
        async loadSettings() {
            return Setting.loadValues(SETTING_NAMESPACE);
        },

        saveSetting(key, value) {
            return Setting.saveValue(SETTING_NAMESPACE, key, value);
        },

        async getActiveAds() {
            const users = await User.find({ 'ticketMarket.activeAd': { $exists: true } }, ACTIVE_AD_PROJECTION).lean();
            return users.map((user) => ({ sellerId: user._id, ...user.ticketMarket.activeAd }));
        },

        async getLastAdPostedAt(sellerId) {
            const user = await User.findById(sellerId, LAST_AD_POSTED_AT_PROJECTION).lean();
            return user?.ticketMarket?.lastAdPostedAt;
        },

        async saveActiveAd(sellerId, ad) {
            const { sellerId: _sellerId, postedAt, ...activeAd } = ad;
            await User.updateOne(
                { _id: sellerId },
                {
                    $set: {
                        'ticketMarket.activeAd': activeAd,
                        'ticketMarket.lastAdPostedAt': postedAt,
                    },
                },
                { upsert: true },
            );
        },

        async updateActiveAd(sellerId, ad) {
            await User.updateOne(
                { _id: sellerId, 'ticketMarket.activeAd': { $exists: true } },
                { $set: { 'ticketMarket.activeAd': ad } },
            );
        },

        async updateActiveAds(ads) {
            if (!ads.length) return;
            await User.bulkWrite(
                ads.map(({ sellerId, ad }) => ({
                    updateOne: {
                        filter: { _id: sellerId, 'ticketMarket.activeAd': { $exists: true } },
                        update: { $set: { 'ticketMarket.activeAd': ad } },
                    },
                })),
                { ordered: false },
            );
        },

        async clearActiveAd(sellerId) {
            await User.updateOne({ _id: sellerId }, { $unset: { 'ticketMarket.activeAd': '' } });
        },

        async clearActiveAds(sellerIds) {
            if (!sellerIds.length) return;
            await User.updateMany({ _id: { $in: sellerIds } }, { $unset: { 'ticketMarket.activeAd': '' } });
        },

        async resetAdsAndCooldowns() {
            await User.updateMany(
                {
                    $or: [
                        { 'ticketMarket.activeAd': { $exists: true } },
                        { 'ticketMarket.lastAdPostedAt': { $exists: true } },
                    ],
                },
                {
                    $unset: {
                        'ticketMarket.activeAd': '',
                        'ticketMarket.lastAdPostedAt': '',
                    },
                },
            );
        },

        async getWrappedTicketCount(userId) {
            const [rows] = await mysql.execute(
                `SELECT COALESCE(ui.count, 0) AS wrapped_ticket_count
                 FROM user u
                 LEFT JOIN user_item ui ON ui.uid = u.uid AND ui.name = 'common_tickets'
                 WHERE u.id = ?`,
                [userId],
            );
            return Number(rows[0]?.wrapped_ticket_count ?? 0);
        },
    };
}
