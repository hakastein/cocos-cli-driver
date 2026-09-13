import test from 'node:test';
import assert from 'node:assert/strict';

import { renderNodeTransforms } from '../src/render/node.ts';

const transform = (position, rotation, scale = { x: 1, y: 1, z: 1 }) => ({ position, rotation, scale });

const info = (local, world) => ({
    uuid: 'u-1', name: 'Shot', active: true, local, world,
    parent: undefined, children: [], components: []
});

test('the float noise of a composed value is dropped, an authored fraction is kept', () => {
    const text = renderNodeTransforms(info(
        transform({ x: 1.23456, y: 0.5, z: -3 }, { x: 0, y: 12.345678, z: 0 }),
        transform({ x: 10.500000000000002, y: -1e-17, z: 0 }, { x: 89.99999999999999, y: 0, z: 0 })
    ));
    assert.deepEqual(text.split('\n'), [
        'local  position 1.23456,0.5,-3  rotation 0,12.345678,0  scale 1,1,1',
        'world  position 10.5,0,0  rotation 90,0,0  scale 1,1,1'
    ]);
});
