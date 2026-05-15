const { parseSnowflake } = require('../util');

describe('parseSnowflake', () => {

    describe('Valid inputs', () => {
        test.each([
            ['17 Digit Snowflake', '12345678901234567', '12345678901234567'],
            ['18 Digit Snowflake', '420105503419531267', '420105503419531267'],
            ['19 Digit Snowflake', '1234567890123456789', '1234567890123456789'],
        ])('%s', (_, input, expected) => {
            expect(parseSnowflake(input)).toEqual(expected);
        });
    });

    describe('Invalid inputs', () => {
        test.each([
            ['Too Short (16 digits)', '1234567890123456'],
            ['Too Long (20 digits)', '12345678901234567890'],
            ['Contains Letters', '12345678901234abc'],
            ['Contains Symbols', '12345678901234-567'],
            ['Channel Mention', '<#420105503419531267>'],
            ['User Mention', '<@210177401064390658>'],
            ['Role Mention', '<@&729574996556382298>'],
            ['Snowflake With Prefix', 'hello420105503419531267'],
            ['Snowflake With Suffix', '420105503419531267hello'],
            ['Empty String', ''],
            ['Whitespace Only', '   '],
            ['Undefined', undefined],
            ['Null', null],
            ['Number', 1234567890],
            ['Object', {}],
        ])('%s', (_, input) => {
            expect(parseSnowflake(input)).toEqual(undefined);
        });
    });

});