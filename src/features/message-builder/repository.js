export function createMessageBuilderDraftRepository({ models }) {
    const User = models.User;

    return {
        async load(userId) {
            const record = await User.findById(userId, { messageBuilder: 1 }).lean();
            const draft = record?.messageBuilder?.draft;

            if (!draft) {
                return undefined;
            }

            return {
                allowMentions: draft.allowMentions === true,
                components: structuredClone(draft.components ?? []),
                ownerId: record._id
            };
        },
        async save(draft) {
            await User.updateOne(
                { _id: draft.ownerId },
                {
                    $set: {
                        'messageBuilder.draft': {
                            allowMentions: draft.allowMentions === true,
                            components: structuredClone(draft.components)
                        }
                    }
                },
                { upsert: true }
            );
        }
    };
}
