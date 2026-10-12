import { applyMessageChanges } from './applyMessageChanges';

const change = (type, id, data, newIndex) => ({
    type,
    newIndex,
    doc: { id, data: () => data },
});

describe('applyMessageChanges', () => {
    it('inserts an added change at newIndex', () => {
        const result = applyMessageChanges([], [change('added', 'a', { text: 'first' }, 0)]);

        expect(result).toEqual([{ id: 'a', text: 'first' }]);
    });

    it('inserts a second added message after the first, in newIndex order', () => {
        const first = applyMessageChanges([], [change('added', 'a', { text: 'first' }, 0)]);

        const result = applyMessageChanges(first, [change('added', 'b', { text: 'second' }, 1)]);

        expect(result).toEqual([
            { id: 'a', text: 'first' },
            { id: 'b', text: 'second' },
        ]);
    });

    it('replaces the existing entry in place for a modified change', () => {
        const first = applyMessageChanges([], [change('added', 'a', { text: 'original' }, 0)]);

        const result = applyMessageChanges(first, [change('modified', 'a', { text: 'edited' }, 0)]);

        expect(result).toEqual([{ id: 'a', text: 'edited' }]);
    });

    it('removes the entry for a removed change', () => {
        const first = applyMessageChanges([], [change('added', 'a', { text: 'first' }, 0)]);

        const result = applyMessageChanges(first, [change('removed', 'a', { text: 'first' }, -1)]);

        expect(result).toEqual([]);
    });

    it('keeps the exact same object reference for a message not present in docChanges', () => {
        const first = applyMessageChanges([], [change('added', 'a', { text: 'first' }, 0)]);

        const second = applyMessageChanges(first, [change('added', 'b', { text: 'second' }, 1)]);

        expect(second[0]).toBe(first[0]);
    });
});
