export function createDatabases({ channels = [], drafts = [], tags = [] } = {}) {
    const db = {
        tags: new Map(tags.map((tag) => [tag._id, tag])),
        channels: new Map(channels.map((channel) => [channel._id, channel])),
        builderDrafts: new Map(drafts.map((draft) => [draft._id, draft]))
    };

    return {
        ...db,
        snail: {
            mongo: {
                BuilderDraft: {
                    find() {
                        return {
                            lean: async () => [...db.builderDrafts.values()]
                        };
                    },
                    findById(id) {
                        return {
                            lean: async () => db.builderDrafts.get(id)
                        };
                    },
                    async updateOne({ _id }, update) {
                        db.builderDrafts.set(_id, { _id, ...db.builderDrafts.get(_id), ...update.$set });
                    }
                },
                Channel: {
                    findById(id) {
                        return {
                            lean: async () => db.channels.get(id)
                        };
                    },
                    async updateOne({ _id }, update) {
                        db.channels.set(_id, { _id, ...db.channels.get(_id), ...update.$set });
                    }
                },
                Tag: {
                    find() {
                        db.tags.findCount = (db.tags.findCount ?? 0) + 1;
                        return {
                            lean: async () => [...db.tags.values()],
                            sort() {
                                return {
                                    lean: async () =>
                                        [...db.tags.values()].sort((left, right) => left._id.localeCompare(right._id))
                                };
                            }
                        };
                    },
                    findById(id) {
                        return {
                            lean: async () => db.tags.get(id)
                        };
                    },
                    async create(tag) {
                        db.tags.set(tag._id, tag);
                    },
                    async deleteOne({ _id }) {
                        const deleted = db.tags.delete(_id);

                        return { deletedCount: deleted ? 1 : 0 };
                    },
                    async updateOne({ _id }, update) {
                        const tag = db.tags.get(_id);
                        if (!tag) {
                            return { matchedCount: 0 };
                        }

                        if (update.$set) {
                            Object.assign(tag, update.$set);
                        }

                        if (update.$addToSet?.publicChannelIDs) {
                            tag.publicChannelIDs ??= [];
                            if (!tag.publicChannelIDs.includes(update.$addToSet.publicChannelIDs)) {
                                tag.publicChannelIDs.push(update.$addToSet.publicChannelIDs);
                            }
                        }

                        if (update.$pull?.publicChannelIDs) {
                            tag.publicChannelIDs = (tag.publicChannelIDs ?? []).filter(
                                (channelID) => channelID !== update.$pull.publicChannelIDs
                            );
                        }

                        return { matchedCount: 1 };
                    }
                }
            }
        }
    };
}

export function createContext({
    channelID = '111111111111111111',
    config = createTestConfig(),
    customID,
    data = {},
    interaction,
    logger = createTestLogger(),
    modalValues = {},
    userID = 'manager-1'
} = {}) {
    return {
        channelID,
        config,
        customID,
        data,
        deferOptions: undefined,
        deferred: false,
        deferUpdateCalled: false,
        memberRoles: ['manager-role'],
        modalValues,
        responses: [],
        followUps: [],
        sentMessages: [],
        userID,
        interaction,
        logger,
        async defer(options) {
            this.deferOptions = options ?? {};
            this.deferred = true;
        },
        async deferUpdate() {
            this.deferUpdateCalled = true;
            this.deferred = true;
        },
        async edit(message) {
            this.editMessage = message;
            return message;
        },
        async editReply(message) {
            this.editReplyMessage = message;
            return message;
        },
        async followUp(message) {
            this.followUpMessage = message;
            this.followUps.push(message);
        },
        async openModal(modal) {
            this.openedModal = modal;
        },
        async respond(message) {
            this.response = message;
            this.responses.push(message);
        },
        async sendMessage(channelID, message) {
            this.sentMessages.push({ channelID, message });
            return message;
        }
    };
}

function createTestConfig() {
    return {
        colors: {
            yellow: 0xf1c40f
        },
        roles: {
            admin: [],
            helper: [],
            manager: ['manager-role']
        },
        users: {
            owner: 'manager-1'
        }
    };
}

function createTestLogger() {
    return {
        debug() {},
        error() {},
        info() {},
        trace() {},
        warn() {},
        time() {
            return {
                end() {},
                fail() {}
            };
        }
    };
}

export function subcommand(name, options = []) {
    return {
        options: [
            {
                name,
                type: 1,
                options
            }
        ]
    };
}
