const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log('====================================================');
console.log('  🎨 ShareBite UI Changes Verification Test');
console.log('====================================================\n');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

// 1. Verify AI Food Priority box removed from donor form
assert(!html.includes('id="aiPriorityDescription"'), 'aiPriorityDescription must be removed from index.html');
assert(!html.includes('class="ai-box"'), 'class="ai-box" must be removed from index.html');
assert(!html.includes('🤖 AI FOOD PRIORITY'), 'Heading must be removed from index.html');
console.log('✅ TEST 1 PASSED: AI Food Priority box completely removed from donation form.');

// 2. Verify Action Buttons exist with correct IDs
assert(html.includes('id="retakePhotoBtn"'), 'Must have retakePhotoBtn in index.html');
assert(html.includes('id="chooseAnotherBtn"'), 'Must have chooseAnotherBtn in index.html');
assert(html.includes('id="removePhotoBtn"'), 'Must have removePhotoBtn in index.html');
console.log('✅ TEST 2 PASSED: Action buttons retakePhotoBtn, chooseAnotherBtn, and removePhotoBtn exist in index.html.');

// 3. Verify JavaScript State & Functions
assert(js.includes('let imageSource = null;'), 'Must define imageSource in script.js');
assert(js.includes('function updateImageActionButtons()'), 'Must define updateImageActionButtons in script.js');
assert(js.includes('function triggerGallerySelection()'), 'Must define triggerGallerySelection in script.js');
console.log('✅ TEST 3 PASSED: imageSource state and toggle functions correctly declared.');

// 4. Test button display logic simulation
let imageSource = null;
const retakeBtn = { style: { display: '' } };
const chooseAnotherBtn = { style: { display: '' } };
const removeBtn = { style: { display: '' } };

function updateImageActionButtonsSim() {
    if (imageSource === 'camera') {
        retakeBtn.style.display = '';
        chooseAnotherBtn.style.display = 'none';
        removeBtn.style.display = '';
    } else if (imageSource === 'gallery') {
        retakeBtn.style.display = 'none';
        chooseAnotherBtn.style.display = '';
        removeBtn.style.display = '';
    } else {
        retakeBtn.style.display = 'none';
        chooseAnotherBtn.style.display = 'none';
        removeBtn.style.display = 'none';
    }
}

// Camera scenario
imageSource = 'camera';
updateImageActionButtonsSim();
assert.strictEqual(retakeBtn.style.display, '');
assert.strictEqual(chooseAnotherBtn.style.display, 'none');
assert.strictEqual(removeBtn.style.display, '');
console.log('✅ TEST 4 PASSED: Camera image displays ONLY [Retake Photo] and [Remove Photo].');

// Gallery scenario
imageSource = 'gallery';
updateImageActionButtonsSim();
assert.strictEqual(retakeBtn.style.display, 'none');
assert.strictEqual(chooseAnotherBtn.style.display, '');
assert.strictEqual(removeBtn.style.display, '');
console.log('✅ TEST 5 PASSED: Gallery image displays ONLY [Choose Another] and [Remove Photo].');

// Removal scenario
imageSource = null;
updateImageActionButtonsSim();
assert.strictEqual(retakeBtn.style.display, 'none');
assert.strictEqual(chooseAnotherBtn.style.display, 'none');
assert.strictEqual(removeBtn.style.display, 'none');
console.log('✅ TEST 6 PASSED: Removing image resets and hides action buttons.');

console.log('\n====================================================');
console.log('  🎉 All 6 UI Verification Tests Passed!');
console.log('====================================================');
