import { createMessageBuilderDraftRepository } from './repository.js';
import { createMessageBuilder } from './service.js';

export default function setupMessageBuilder({ databases }) {
    const messageBuilder = createMessageBuilder({
        draftRepository: createMessageBuilderDraftRepository(databases.snail.mongo)
    });

    return {
        services: {
            messageBuilder: messageBuilder.service
        },
        routes: messageBuilder.routes
    };
}
