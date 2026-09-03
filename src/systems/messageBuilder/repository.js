export function createDraftRepository(User) {
    return {
        async load(userId) {
            const user = await User.findById(userId, { messageBuilder: 1 }).lean();
            return user?.messageBuilder?.draft;
        },

        async save(userId, draft) {
            await User.updateOne({ _id: userId }, { $set: { 'messageBuilder.draft': draft } }, { upsert: true });
        },
    };
}
