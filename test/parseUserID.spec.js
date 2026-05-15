const { parseUserID } = require('../util');

describe('parseUserID', () => {
    describe('Valid inputs', () => {
        test.each([
            ['User Mention', '<@210177401064390658>', '210177401064390658'],
            ['User Mention (!)', '<@!210177401064390658>', '210177401064390658'],
            ['Snowflake', '210177401064390658', '210177401064390658'],
        ])('%s', (_, input, expected) => {
            expect(parseUserID(input)).toEqual(expected);
        });
    });

    describe('Invalid inputs', () => {
        test.each([
            ['Channel Mention', '<#420105503419531267>'],
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
            expect(parseUserID(input)).toEqual(undefined);
        });
    });
});
