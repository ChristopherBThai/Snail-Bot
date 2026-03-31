const { parseChannelID } = require('../util');

// TODO Tests for other functions in util file
// One file per function?

describe('Parse Channel ID', () => {

    describe('Normal cases', () => {
        test.each([
            ['Channel Mention', '<#420105503419531267>', '420105503419531267'],
            ['Raw ID', '420105503419531267', '420105503419531267'],
        ])('%s', (_, input, expected) => {
            expect(parseChannelID(input)).toEqual(expected);
        });
    });

    // TODO: Support channel links

});