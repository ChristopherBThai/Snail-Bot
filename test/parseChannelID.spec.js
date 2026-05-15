const { parseChannelID } = require('../util');

describe('parseChannelID', () => {
    describe('Valid inputs', () => {
        test.each([
            ['Channel Mention', '<#420105503419531267>', '420105503419531267'],
            ['Snowflake', '420105503419531267', '420105503419531267'],
            [
                'Channel Link',
                'https://discord.com/channels/420104212895105044/420105503419531267',
                '420105503419531267',
            ],
            [
                'Channel Link (PTB)',
                'https://ptb.discord.com/channels/420104212895105044/420105503419531267',
                '420105503419531267',
            ],
            [
                'Channel Link (Canary)',
                'https://canary.discord.com/channels/420104212895105044/420105503419531267',
                '420105503419531267',
            ],
        ])('%s', (_, input, expected) => {
            expect(parseChannelID(input)).toEqual(expected);
        });
    });

    describe('Invalid inputs', () => {
        test.each([
            ['User Mention', '<@210177401064390658>'],
            ['Role Mention', '<@&729574996556382298>'],
            ['Snowflake (too short)', '1234567890123456'],
            ['Snowflake (too long)', '12345678901234567890'],
            ['Empty String', ''],
            ['Whitespace Only', '   '],
            ['Undefined', undefined],
            ['Null', null],
            ['Number', 1234567890],
            ['Object', {}],
        ])('%s', (_, input) => {
            expect(parseChannelID(input)).toEqual(undefined);
        });
    });
});
