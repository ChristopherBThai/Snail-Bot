import { ButtonStyle, ComponentType, MessageFlags, TextInputStyle } from 'discord-api-types/v10';
import { describe, expect, test } from 'vitest';
import {
    actionRow,
    button,
    checkboxGroup,
    componentsMessage,
    container,
    label,
    linkButton,
    mediaGallery,
    mediaURLItem,
    section,
    separator,
    stringSelect,
    textDisplay,
    textInput,
    thumbnailURL
} from './components.js';

describe('Discord component helpers', () => {
    test('builds Components V2 messages', () => {
        expect(componentsMessage([textDisplay('Hello')])).toEqual({
            flags: MessageFlags.IsComponentsV2,
            components: [
                {
                    type: ComponentType.TextDisplay,
                    content: 'Hello'
                }
            ]
        });
        expect(componentsMessage([textDisplay('Hello')], { ephemeral: true })).toEqual({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [
                {
                    type: ComponentType.TextDisplay,
                    content: 'Hello'
                }
            ]
        });
    });

    test('builds interactive component payloads', () => {
        expect(actionRow([linkButton('Docs', 'https://example.com')])).toEqual({
            type: ComponentType.ActionRow,
            components: [
                {
                    type: ComponentType.Button,
                    style: ButtonStyle.Link,
                    label: 'Docs',
                    url: 'https://example.com'
                }
            ]
        });

        expect(button('button-id', 'Click', { style: ButtonStyle.Primary })).toEqual({
            type: ComponentType.Button,
            custom_id: 'button-id',
            disabled: false,
            label: 'Click',
            style: ButtonStyle.Primary
        });

        expect(
            stringSelect('select-id', [{ label: 'One', value: 'one' }], 'Pick', {
                disabled: true
            })
        ).toEqual({
            type: ComponentType.StringSelect,
            custom_id: 'select-id',
            disabled: true,
            options: [{ label: 'One', value: 'one' }],
            placeholder: 'Pick'
        });

        expect(stringSelect('modal-select-id', [{ label: 'One', value: 'one' }], 'Pick')).toEqual({
            type: ComponentType.StringSelect,
            custom_id: 'modal-select-id',
            options: [{ label: 'One', value: 'one' }],
            placeholder: 'Pick'
        });
    });

    test('builds modal component payloads', () => {
        expect(
            checkboxGroup('checkbox-id', [{ label: 'One', value: 'one', default: true }], {
                maxValues: 1,
                minValues: 0
            })
        ).toEqual({
            type: ComponentType.CheckboxGroup,
            custom_id: 'checkbox-id',
            max_values: 1,
            min_values: 0,
            options: [{ label: 'One', value: 'one', default: true }],
            required: false
        });

        expect(
            textInput('input-id', {
                maxLength: 80,
                placeholder: 'Write something',
                required: false,
                style: TextInputStyle.Paragraph,
                value: 'Prefilled'
            })
        ).toEqual({
            type: ComponentType.TextInput,
            custom_id: 'input-id',
            max_length: 80,
            placeholder: 'Write something',
            required: false,
            style: TextInputStyle.Paragraph,
            value: 'Prefilled'
        });

        expect(label('Text', textInput('input-id', { style: TextInputStyle.Paragraph }))).toEqual({
            type: ComponentType.Label,
            label: 'Text',
            component: {
                type: ComponentType.TextInput,
                custom_id: 'input-id',
                required: true,
                style: TextInputStyle.Paragraph
            }
        });
    });

    test('builds section payloads', () => {
        const body = textDisplay('Body');
        const thumbnail = thumbnailURL('https://example.com/image.png', { spoiler: true });

        expect(section([body], thumbnail)).toEqual({
            type: ComponentType.Section,
            components: [body],
            accessory: thumbnail
        });
    });

    test('builds container payloads', () => {
        const accentColor = 0x5865f2;

        expect(container([separator()], { accentColor, spoiler: true })).toEqual({
            type: ComponentType.Container,
            accent_color: accentColor,
            spoiler: true,
            components: [
                {
                    type: ComponentType.Separator,
                    divider: true,
                    spacing: undefined
                }
            ]
        });
    });

    test('builds media gallery payloads', () => {
        expect(mediaGallery([mediaURLItem('https://example.com/image.png', { spoiler: true })])).toEqual({
            type: ComponentType.MediaGallery,
            items: [
                {
                    media: {
                        url: 'https://example.com/image.png'
                    },
                    spoiler: true
                }
            ]
        });
    });
});
