import test from 'node:test';
import assert from 'node:assert/strict';

import { PROMPTING_METHODS, raisesDialog } from '../dist/protocol.js';

test('open, close and build are the primitives the editor answers with a dialog; a save is not', () => {
    assert.deepEqual([...PROMPTING_METHODS],
        ['editor.scene.openScene', 'editor.scene.closeScene', 'editor.builder.addTask']);
    assert.equal(raisesDialog('editor.builder.addTask'), true);
    assert.equal(raisesDialog('editor.scene.saveScene'), false);
});
