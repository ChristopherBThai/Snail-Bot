const { parseQuoted } = require('../util');

// TODO Tests for other functions in util file
// One file per function?

describe('Parse Quoted', () => {

    test('Empty args', () => {
        expect(parseQuoted([])).toEqual([undefined, []]);
    });

    describe('Normal cases', () => {
        test.each([
            ['Empty quoted', ['""', 'after'], ['', ['after']]],
            ['One word', ['"Hello!"', 'after'], ['Hello!', ['after']]],
            ['Two words', ['"Hello', 'world!"', 'after'], ['Hello world!', ['after']]],
            [
                'Many words',
                ['"Hello', 'world', 'but', 'longer', 'and', 'has', 'words', 'after"', 'after'],
                ['Hello world but longer and has words after', ['after']]
            ],
            ['Consumes all args', ['"Hello', 'world!"'], ['Hello world!', []]],
            [
                'Leaves multiple args',
                ['"Hello,', 'world!"', 'after', 'next', 'last'],
                ['Hello, world!', ['after', 'next', 'last']]
            ],
        ])('%s', (_, input, expected) => {
            expect(parseQuoted(input)).toEqual(expected);
        });
    });

    describe('Custom delimiter', () => {
        test.each([
            ['Basic custom delimiter', ['#Hello', 'world!#', 'after'], ['Hello world!', ['after']], '#'],
            ['Multicharacter custom delimiter', ['###Hello', 'world!###', 'after'], ['Hello world!', ['after']], '###']
        ])('%s', (_, input, expected, delim) => {
            expect(parseQuoted(input, delim)).toEqual(expected);
        });
    });

    describe('Odd spaces', () => {
        test.each([
            ['Leading space', ['"', 'Hello', 'world!"', 'after'], [' Hello world!', ['after']]],
            ['Trailing space', ['"Hello', 'world!', '"', 'after'], ['Hello world! ', ['after']]],
            ['Only delimiters', ['"', '"', 'after'], [' ', ['after']]],
        ])('%s', (_, input, expected) => {
            expect(parseQuoted(input)).toEqual(expected);
        });
    });

    describe('Missing delimiter', () => {
        test.each([
            ['No delimiter at all', ['Hello', 'world!', 'after'], [undefined, ['Hello', 'world!', 'after']]],
            ['Not opened', ['Hello', 'world!"', 'after'], [undefined, ['Hello', 'world!"', 'after']]],
            ['Not closed', ['"Hello', 'world!', 'after'], [undefined, ['"Hello', 'world!', 'after']]],
        ])('%s', (_, input, expected) => {
            expect(parseQuoted(input)).toEqual(expected);
        });
    });

    // TODO: Support escaped quotes

});