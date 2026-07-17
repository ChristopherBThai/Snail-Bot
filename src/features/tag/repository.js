export function createTagRepository(snailMongo) {
    const { Channel, Tag } = snailMongo.models;

    return {
        async createTag({ createdBy, message, name }) {
            return Tag.create({
                _id: name,
                createdBy,
                message,
                updatedBy: createdBy
            });
        },
        async deleteTag(name) {
            const result = await Tag.deleteOne({ _id: name });

            return result.deletedCount > 0;
        },
        findTag(name) {
            return Tag.findById(name).lean();
        },
        async getChannelPolicy(channelId) {
            return Channel.findById(channelId).lean();
        },
        async getPublicTagsInChannel(channelId) {
            const tags = await Tag.find({ publicChannelIds: channelId }, { _id: 1 }).sort({ _id: 1 }).lean();

            return tags.map((tag) => tag._id);
        },
        async listTagNames() {
            const tags = await Tag.find({}, { _id: 1 }).sort({ _id: 1 }).lean();

            return tags.map((tag) => tag._id);
        },
        async setChannelDefault({ channelId, isPublic }) {
            await Channel.updateOne({ _id: channelId }, { $set: { tagsPublicByDefault: isPublic } }, { upsert: true });
        },
        async setTagPublic({ channelId, isPublic, name }) {
            const update = isPublic
                ? { $addToSet: { publicChannelIds: channelId } }
                : { $pull: { publicChannelIds: channelId } };
            const result = await Tag.updateOne({ _id: name }, update);

            return result.matchedCount > 0;
        },
        async trackTagUse(name) {
            await Tag.updateOne(
                { _id: name },
                {
                    $inc: { uses: 1 },
                    $set: { lastUsedAt: new Date() }
                }
            );
        },
        async updateTag({ message, name, updatedBy }) {
            const result = await Tag.updateOne({ _id: name }, { $set: { message, updatedBy } });

            return result.matchedCount > 0;
        }
    };
}
