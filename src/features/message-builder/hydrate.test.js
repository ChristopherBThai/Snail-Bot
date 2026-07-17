import { describe, expect, test } from 'vitest';
import { ButtonStyle, ComponentType } from '../../discord/components.js';
import { BuilderComponentTypes } from './constants.js';
import { createDraftFromMessage, HydrationRejectReasons } from './hydrate.js';

describe('Message Builder hydration', () => {
    test('hydrates editable Discord messages into builder drafts', () => {
        const result = createDraftFromMessage(
            {
                content: 'Plain content',
                components: [
                    { type: ComponentType.TextDisplay, content: 'Text display' },
                    { type: ComponentType.Separator },
                    {
                        type: ComponentType.ActionRow,
                        components: [
                            {
                                type: ComponentType.Button,
                                style: ButtonStyle.Link,
                                label: 'Guide',
                                url: 'https://example.com/guide'
                            }
                        ]
                    },
                    {
                        type: ComponentType.Section,
                        components: [{ type: ComponentType.TextDisplay, content: 'Section text' }],
                        accessory: {
                            type: ComponentType.Thumbnail,
                            media: { url: 'https://example.com/thumb.png' },
                            spoiler: true
                        }
                    },
                    {
                        type: ComponentType.MediaGallery,
                        items: [{ media: { url: 'https://example.com/image.png' }, spoiler: true }]
                    },
                    {
                        type: ComponentType.Container,
                        accent_color: 0x5865f2,
                        spoiler: true,
                        components: [{ type: ComponentType.TextDisplay, content: 'Inside' }]
                    }
                ]
            },
            { ownerId: 'hydrate-user' }
        );

        expect(result).toMatchObject({
            ok: true,
            draft: {
                components: [
                    { type: BuilderComponentTypes.Text, content: 'Plain content' },
                    { type: BuilderComponentTypes.Text, content: 'Text display' },
                    { type: BuilderComponentTypes.Separator, divider: undefined, spacing: undefined },
                    {
                        type: BuilderComponentTypes.LinkButtons,
                        buttons: [{ label: 'Guide', url: 'https://example.com/guide' }]
                    },
                    {
                        type: BuilderComponentTypes.Section,
                        texts: ['Section text'],
                        thumbnailSpoiler: true,
                        thumbnailUrl: 'https://example.com/thumb.png'
                    },
                    {
                        type: BuilderComponentTypes.MediaGallery,
                        items: [{ spoiler: true, url: 'https://example.com/image.png' }]
                    },
                    {
                        type: BuilderComponentTypes.Container,
                        accentColor: 0x5865f2,
                        spoiler: true,
                        children: [{ type: BuilderComponentTypes.Text, content: 'Inside' }]
                    }
                ],
                ownerId: 'hydrate-user',
                selectedComponentPath: [0]
            }
        });
    });

    test('rejects unsupported Discord messages during hydration', () => {
        expect(createDraftFromMessage({ embeds: [{}] }, { ownerId: 'hydrate-user' })).toEqual({
            ok: false,
            reason: HydrationRejectReasons.Embeds
        });
        expect(createDraftFromMessage({ attachments: [{ id: '1' }] }, { ownerId: 'hydrate-user' })).toEqual({
            ok: false,
            reason: HydrationRejectReasons.Attachments
        });
        expect(createDraftFromMessage({ poll: { question: {} } }, { ownerId: 'hydrate-user' })).toEqual({
            ok: false,
            reason: HydrationRejectReasons.UnsupportedContent
        });
        expect(
            createDraftFromMessage(
                {
                    components: [
                        {
                            type: ComponentType.ActionRow,
                            components: [
                                {
                                    type: ComponentType.Button,
                                    style: ButtonStyle.Secondary,
                                    label: 'Nope',
                                    custom_id: 'nope'
                                }
                            ]
                        }
                    ]
                },
                { ownerId: 'hydrate-user' }
            )
        ).toEqual({ ok: false, reason: HydrationRejectReasons.UnsupportedComponent });
    });
});
