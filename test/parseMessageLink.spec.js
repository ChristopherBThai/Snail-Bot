const { parseMessageLink } = require('../util');

describe('parseMessageLink', () => {
    describe('Valid inputs', () => {
        test.each([
            [
                'Discord Link',
                'https://discord.com/channels/420104212895105044/420105503419531267/1462362835903451186',
                {
                    guildID: '420104212895105044',
                    channelID: '420105503419531267',
                    messageID: '1462362835903451186',
                },
            ],
            [
                'Discord Link 2',
                'https://discord.com/channels/420104212895105044/420105503419531267/1412275061741588593',
                {
                    guildID: '420104212895105044',
                    channelID: '420105503419531267',
                    messageID: '1412275061741588593',
                },
            ],
            [
                'PTB Link',
                'https://ptb.discord.com/channels/420104212895105044/420105503419531267/1462362835903451186',
                {
                    guildID: '420104212895105044',
                    channelID: '420105503419531267',
                    messageID: '1462362835903451186',
                },
            ],
            [
                'Canary Link',
                'https://canary.discord.com/channels/420104212895105044/420105503419531267/1462362835903451186',
                {
                    guildID: '420104212895105044',
                    channelID: '420105503419531267',
                    messageID: '1462362835903451186',
                },
            ],
        ])('%s', (_, input, expected) => {
            expect(parseMessageLink(input)).toEqual(expected);
        });
    });

    describe('Invalid inputs', () => {
        test.each([
            ['Channel Mention', '<#420105503419531267>'],
            ['User Mention', '<@210177401064390658>'],
            ['Role Mention', '<@&729574996556382298>'],
            ['Missing Message ID', 'https://discord.com/channels/420104212895105044/420105503419531267'],
            ['Missing Channel ID', 'https://discord.com/channels/420104212895105044'],
            [
                'Extra Path',
                'https://discord.com/channels/420104212895105044/420105503419531267/1462362835903451186/extra',
            ],
            ['Guild ID Too Short', 'https://discord.com/channels/123/420105503419531267/1462362835903451186'],
            ['Channel ID Too Short', 'https://discord.com/channels/420104212895105044/123/1462362835903451186'],
            ['Message ID Too Short', 'https://discord.com/channels/420104212895105044/420105503419531267/123'],
            ['Empty String', ''],
            ['Whitespace Only', '   '],
            ['Undefined', undefined],
            ['Null', null],
            ['Number', 1234567890],
            ['Object', {}],
        ])('%s', (_, input) => {
            expect(parseMessageLink(input)).toEqual(undefined);
        });
    });
});
