import test from 'node:test';
import assert from 'node:assert/strict';

import {
    componentCid, descriptorOf, findProperty, propertyNames,
    readComponentProperties, selectComponent
} from '../src/property/component-dump.ts';

const number = (name, value, declared) => ({
    name, value, type: 'Number', visible: true, extends: [], ...(declared === undefined ? {} : { default: declared })
});

const camera = () => ({
    type: 'cc.Camera',
    cid: 'cc.Camera',
    value: {
        uuid: { value: 'dabrkqxkxNGIE3ZFR2iTFu', type: 'String', visible: false },
        enabled: { name: 'enabled', value: true, type: 'Boolean', visible: false },
        node: { name: 'node', value: { uuid: 'd2s/upPEVGCpi7iGBngsl3' }, type: 'cc.Node', visible: false, extends: ['cc.Object'] },
        _fov: { name: '_fov', value: 45, type: 'Number', visible: false, extends: [] },
        _near: { name: '_near', value: 1, type: 'Number', visible: false, extends: [] },
        _color: { name: '_color', value: { r: 255, g: 255, b: 255, a: 255 }, type: 'cc.Color', visible: false, extends: ['cc.ValueType'] },
        fov: { name: 'fov', value: 45, type: 'Number', visible: true, extends: [] },
        near: { name: 'near', value: 2, type: 'Number', visible: true, extends: [] },
        orthoHeight: { name: 'orthoHeight', value: 10, type: 'Number', visible: false, extends: [] },
        projection: {
            name: 'projection', value: 1, type: 'Enum', visible: true, extends: [],
            enumList: [{ name: 'ORTHO', value: 0 }, { name: 'PERSPECTIVE', value: 1 }]
        },
        clearFlags: {
            name: 'clearFlags', value: 6, type: 'BitMask', visible: true, extends: [],
            bitmaskList: [{ name: 'NONE', value: 0 }, { name: 'DEPTH', value: 2 }, { name: 'STENCIL', value: 4 }]
        }
    }
});

const bootstrap = () => ({
    type: 'GameBootstrap',
    cid: '646dcEg/PRLbZWLiQkjf9IA',
    value: {
        enabled: { name: 'enabled', value: false, type: 'Boolean', visible: false },
        prewarm: number('prewarm', 8, 8),
        waypointRadius: number('waypointRadius', 1.4, 0.7),
        hero: {
            name: 'hero', value: { uuid: '255rIRyPxOX5xNSUYxZLLP' }, default: null,
            type: 'cc.Node', visible: true, extends: ['cc.Object']
        }
    }
});

test('an engine component answers the bare spelling and is called by its registered name', () => {
    const choice = selectComponent([camera()], 'Camera');
    assert.equal(choice.className, 'cc.Camera');
    assert.equal(choice.index, 0);
    assert.equal(choice.enabled, true);
});

test('an exact spelling beats the prefixed one: cc.Sprite and a local Sprite stay distinct', () => {
    const comps = [{ type: 'cc.Sprite', value: {} }, { type: 'Sprite', value: {} }];
    assert.equal(selectComponent(comps, 'Sprite').index, 1);
    assert.equal(selectComponent(comps, 'cc.Sprite').index, 0);
});

const spline = (uuid) => ({
    type: 'SplineAnimate', value: { uuid: { value: uuid, type: 'String', visible: false } }
});

// A bare name that is exact for one component and ambiguous for the other is how node paths put a
// write on the wrong node before same-named siblings were numbered.
test('a bare class the node carries twice is refused, naming each by position and uuid', () => {
    const choice = selectComponent([spline('u-arrive'), camera(), spline('u-leave')], 'SplineAnimate');
    assert.equal(choice.error,
        "'SplineAnimate' matches 2 components of the node: SplineAnimate#1 u-arrive, SplineAnimate#2 u-leave");
    assert.equal(choice.absent, false);
});

test('#N picks the Nth component of the class in component order, and carries its own uuid', () => {
    const choice = selectComponent([spline('u-arrive'), camera(), spline('u-leave')], 'SplineAnimate#2');
    assert.equal(choice.index, 2);
    assert.equal(choice.sameClassIndex, 1);
    assert.equal(choice.label, 'SplineAnimate#2');
    assert.equal(choice.uuid, 'u-leave');
});

test('#N takes the prefixed spelling too', () => {
    const comps = [{ type: 'cc.Sprite', value: {} }, { type: 'cc.Sprite', value: {} }];
    assert.equal(selectComponent(comps, 'Sprite#2').index, 1);
});

test('a class the node carries once answers to its bare name and to #1', () => {
    const comps = [camera(), spline('u-arrive')];
    assert.equal(selectComponent(comps, 'SplineAnimate').label, 'SplineAnimate');
    assert.equal(selectComponent(comps, 'SplineAnimate#1').uuid, 'u-arrive');
});

test('a position past the last component of the class is refused, naming what the node carries', () => {
    const choice = selectComponent([spline('u-arrive'), spline('u-leave')], 'SplineAnimate#3');
    assert.equal(choice.error, "the node carries 2 SplineAnimate, so 'SplineAnimate#3' names none of "
        + 'them; it carries: SplineAnimate#1, SplineAnimate#2');
    assert.equal(choice.absent, false);
});

test('a class the dump names only through __type__ answers both spellings', () => {
    const comps = [{ __type__: 'cc.Sprite', value: {} }];
    assert.equal(selectComponent(comps, 'Sprite').className, 'cc.Sprite');
    assert.equal(selectComponent(comps, 'cc.Sprite').className, 'cc.Sprite');
});

test('the cid for the serializer is taken in its own order while the class name is printed', () => {
    const component = { type: 'GameBootstrap', cid: '646dcEg/PRLbZWLiQkjf9IA', value: {} };
    assert.equal(componentCid(component), '646dcEg/PRLbZWLiQkjf9IA');
    assert.equal(componentCid({ __type__: 'cc.Sprite', cid: 'other', value: {} }), 'cc.Sprite');
    assert.equal(componentCid({ value: {} }), null);
    assert.equal(selectComponent([component], 'GameBootstrap').className, 'GameBootstrap');
});

test('a write looks the descriptor up by exactly the name given: the same path is written', () => {
    assert.equal(descriptorOf(camera(), '_fov').value, 45);
    assert.equal(descriptorOf(camera(), 'color'), null);
    assert.equal(findProperty(camera(), 'color').name, '_color');
});

test('the class is absent from the node — refused, naming what the node carries', () => {
    const choice = selectComponent([camera(), bootstrap()], 'cc.MeshRenderer');
    assert.equal(choice.error,
        "the node carries no component 'cc.MeshRenderer'; it carries: cc.Camera, GameBootstrap");
    assert.equal(choice.absent, true);
});

test('the editor internal fields stay out of the list and are named among the hidden ones', () => {
    const { readings, hidden } = readComponentProperties(bootstrap());
    assert.deepEqual(readings.map(reading => reading.name), ['prewarm', 'waypointRadius', 'hero']);
    assert.deepEqual(hidden, ['enabled']);
});

test('a backing field collapses into its accessor only when the values are equal', () => {
    const { readings, hidden } = readComponentProperties(camera());
    const names = readings.map(reading => reading.name);
    assert.ok(!names.includes('_fov'), 'an equal _fov/fov pair has to collapse');
    assert.ok(hidden.includes('_fov'));
    assert.ok(names.includes('_near'), 'a diverging _near/near pair must not collapse');
    assert.ok(names.includes('near'));
});

test('a backing field with no accessor stays: _color reads as a color', () => {
    const { readings } = readComponentProperties(camera());
    const color = readings.find(reading => reading.name === '_color');
    assert.deepEqual(color.value, { r: 255, g: 255, b: 255, a: 255 });
    assert.equal(color.kind, 'color');
});

test('a property the inspector does not draw does not fall out of the reading', () => {
    const { readings } = readComponentProperties(camera());
    const ortho = readings.find(reading => reading.name === 'orthoHeight');
    assert.equal(ortho.value, 10);
    assert.equal(ortho.hiddenInInspector, true);
});

test('an enum is named by its member and a bitmask by the flags that are set', () => {
    const { readings } = readComponentProperties(camera());
    assert.equal(readings.find(reading => reading.name === 'projection').label, 'PERSPECTIVE');
    assert.equal(readings.find(reading => reading.name === 'clearFlags').label, 'DEPTH|STENCIL');
});

test('a value that drifted from the default is marked and a matching one is not', () => {
    const { readings } = readComponentProperties(bootstrap());
    assert.equal(readings.find(reading => reading.name === 'waypointRadius').differsFromDefault, true);
    assert.equal(readings.find(reading => reading.name === 'prewarm').differsFromDefault, false);
});

test('a reference against an empty default: a set one drifted, an unset one did not', () => {
    const empty = bootstrap();
    empty.value.hero.value = { uuid: '' };
    assert.equal(readComponentProperties(bootstrap())
        .readings.find(reading => reading.name === 'hero').differsFromDefault, true);
    assert.equal(readComponentProperties(empty)
        .readings.find(reading => reading.name === 'hero').differsFromDefault, false);
});

test('a default that arrived as a descriptor tree yields no verdict', () => {
    const component = camera();
    component.value.fov.default = { type: 'cc.Color', value: { r: { value: 51 } } };
    const { readings } = readComponentProperties(component);
    assert.equal(readings.find(reading => reading.name === 'fov').differsFromDefault, null);
});

test('no default in the dump means no verdict either', () => {
    const { readings } = readComponentProperties(camera());
    assert.equal(readings.find(reading => reading.name === 'projection').differsFromDefault, null);
});

test('by name both an internal field and a backing field are reachable', () => {
    assert.equal(findProperty(camera(), '_fov').value, 45);
    assert.equal(findProperty(bootstrap(), 'enabled').value, false);
});

test('an accessor name answers from the backing field when the accessor itself is absent', () => {
    const reading = findProperty(camera(), 'color');
    assert.equal(reading.name, '_color');
    assert.deepEqual(reading.value, { r: 255, g: 255, b: 255, a: 255 });
});

test('a name absent in every spelling gives null, and the name list for the refusal is complete', () => {
    assert.equal(findProperty(bootstrap(), 'nope'), null);
    assert.deepEqual(propertyNames(bootstrap()), ['enabled', 'prewarm', 'waypointRadius', 'hero']);
});
