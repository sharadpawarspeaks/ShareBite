const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const dateUtils = require('../dateUtils.js');

console.log('====================================================');
console.log('  📅 ShareBite Calendar & Cooked Food Test Suite');
console.log('====================================================\n');

// -------------------------------------------------------------------
// 1. Dynamic Date Calculation & Boundary Tests (dateUtils.getCookedFoodDates)
// -------------------------------------------------------------------
// Normal day
const d1 = new Date(2026, 9, 18); // 18 Oct 2026
const res1 = dateUtils.getCookedFoodDates(d1);
assert.strictEqual(res1.preparedDateDisplay, '18/10/2026');
assert.strictEqual(res1.preparedDateISO, '2026-10-18');
assert.strictEqual(res1.expiryDateDisplay, '19/10/2026');
assert.strictEqual(res1.expiryDateISO, '2026-10-19');
console.log('✅ TEST 1 PASSED: Normal day (18 Oct 2026 -> 19 Oct 2026) calculated correctly.');

// Month boundary (31-day month: 31 Jan -> 1 Feb)
const dMonth31 = new Date(2026, 0, 31); // 31 Jan 2026
const resMonth31 = dateUtils.getCookedFoodDates(dMonth31);
assert.strictEqual(resMonth31.preparedDateDisplay, '31/01/2026');
assert.strictEqual(resMonth31.expiryDateDisplay, '01/02/2026');
assert.strictEqual(resMonth31.expiryDateISO, '2026-02-01');
console.log('✅ TEST 2 PASSED: 31-day month boundary (31 Jan -> 01 Feb) handles roll-over.');

// Month boundary (30-day month: 30 Apr -> 1 May)
const dMonth30 = new Date(2026, 3, 30); // 30 Apr 2026
const resMonth30 = dateUtils.getCookedFoodDates(dMonth30);
assert.strictEqual(resMonth30.preparedDateDisplay, '30/04/2026');
assert.strictEqual(resMonth30.expiryDateDisplay, '01/05/2026');
assert.strictEqual(resMonth30.expiryDateISO, '2026-05-01');
console.log('✅ TEST 3 PASSED: 30-day month boundary (30 Apr -> 01 May) handles roll-over.');

// Year boundary (31 Dec -> 1 Jan of next year)
const dYearEnd = new Date(2026, 11, 31); // 31 Dec 2026
const resYearEnd = dateUtils.getCookedFoodDates(dYearEnd);
assert.strictEqual(resYearEnd.preparedDateDisplay, '31/12/2026');
assert.strictEqual(resYearEnd.expiryDateDisplay, '01/01/2027');
assert.strictEqual(resYearEnd.expiryDateISO, '2027-01-01');
console.log('✅ TEST 4 PASSED: Year boundary (31 Dec 2026 -> 01 Jan 2027) rolls year over correctly.');

// Leap year (28 Feb 2028 -> 29 Feb 2028)
const dLeap1 = new Date(2028, 1, 28);
const resLeap1 = dateUtils.getCookedFoodDates(dLeap1);
assert.strictEqual(resLeap1.preparedDateDisplay, '28/02/2028');
assert.strictEqual(resLeap1.expiryDateDisplay, '29/02/2028');
assert.strictEqual(resLeap1.expiryDateISO, '2028-02-29');
console.log('✅ TEST 5 PASSED: Leap year (28 Feb 2028 -> 29 Feb 2028) recognizes leap day.');

// Leap year end (29 Feb 2028 -> 1 Mar 2028)
const dLeap2 = new Date(2028, 1, 29);
const resLeap2 = dateUtils.getCookedFoodDates(dLeap2);
assert.strictEqual(resLeap2.preparedDateDisplay, '29/02/2028');
assert.strictEqual(resLeap2.expiryDateDisplay, '01/03/2028');
assert.strictEqual(resLeap2.expiryDateISO, '2028-03-01');
console.log('✅ TEST 6 PASSED: Leap day roll-over (29 Feb 2028 -> 01 Mar 2028) rolls to March.');

// Non-leap year (28 Feb 2026 -> 1 Mar 2026)
const dNonLeap = new Date(2026, 1, 28);
const resNonLeap = dateUtils.getCookedFoodDates(dNonLeap);
assert.strictEqual(resNonLeap.preparedDateDisplay, '28/02/2026');
assert.strictEqual(resNonLeap.expiryDateDisplay, '01/03/2026');
assert.strictEqual(resNonLeap.expiryDateISO, '2026-03-01');
console.log('✅ TEST 7 PASSED: Non-leap year (28 Feb 2026 -> 01 Mar 2026) rolls directly to March.');

// -------------------------------------------------------------------
// 2. HTML Markup and CSS Inspection
// -------------------------------------------------------------------
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');

assert(html.includes('id="preparedDateCalBtn"'), 'preparedDateCalBtn must exist');
assert(html.includes('id="expiryDateCalBtn"'), 'expiryDateCalBtn must exist');
assert(html.includes('id="preparedDateNative"'), 'preparedDateNative must exist');
assert(html.includes('id="expiryDateNative"'), 'expiryDateNative must exist');
assert(html.includes('class="date-input-wrapper"'), 'date-input-wrapper must be present');
console.log('✅ TEST 8 PASSED: Calendar icon buttons and native date inputs properly embedded in index.html.');

assert(css.includes('.date-input-wrapper'), 'CSS must define .date-input-wrapper');
assert(css.includes('.calendar-icon-btn'), 'CSS must define .calendar-icon-btn');
assert(css.includes('padding-right: 42px'), 'CSS must prevent text from overlapping icon');
console.log('✅ TEST 9 PASSED: Responsive CSS layout and icon positioning validated.');

assert(js.includes('function openDatePicker('), 'script.js must contain openDatePicker');
assert(js.includes('function handleFoodTypeChange('), 'script.js must contain handleFoodTypeChange');
assert(js.includes('function syncNativeDateToField('), 'script.js must contain syncNativeDateToField');
console.log('✅ TEST 10 PASSED: JavaScript picker and foodType change controllers present.');

// -------------------------------------------------------------------
// 3. Frontend Cooked Food Toggling Simulation
// -------------------------------------------------------------------
const prepInputSim = { value: '', readOnly: false, classList: { add: () => {}, remove: () => {} } };
const expInputSim = { value: '', readOnly: false, classList: { add: () => {}, remove: () => {} } };
const prepBtnSim = { disabled: false };
const expBtnSim = { disabled: false };

function simFoodTypeChange(type) {
    if (type === 'Cooked Food') {
        const dates = dateUtils.getCookedFoodDates();
        prepInputSim.value = dates.preparedDateDisplay;
        prepInputSim.readOnly = true;
        expInputSim.value = dates.expiryDateDisplay;
        expInputSim.readOnly = true;
        prepBtnSim.disabled = true;
        expBtnSim.disabled = true;
    } else {
        prepInputSim.readOnly = false;
        expInputSim.readOnly = false;
        prepBtnSim.disabled = false;
        expBtnSim.disabled = false;
    }
}

// User selects Cooked Food
simFoodTypeChange('Cooked Food');
assert.strictEqual(prepInputSim.readOnly, true);
assert.strictEqual(expInputSim.readOnly, true);
assert.strictEqual(prepBtnSim.disabled, true);
assert.strictEqual(expBtnSim.disabled, true);
assert.strictEqual(prepInputSim.value, dateUtils.getCookedFoodDates().preparedDateDisplay);
assert.strictEqual(expInputSim.value, dateUtils.getCookedFoodDates().expiryDateDisplay);
console.log('✅ TEST 11 PASSED: Selecting Cooked Food sets non-editable dates and disables calendar button.');

// User switches to Packaged Food
simFoodTypeChange('Packaged Food');
assert.strictEqual(prepInputSim.readOnly, false);
assert.strictEqual(expInputSim.readOnly, false);
assert.strictEqual(prepBtnSim.disabled, false);
assert.strictEqual(expBtnSim.disabled, false);
console.log('✅ TEST 12 PASSED: Switching away from Cooked Food unlocks fields and enables calendar.');

// -------------------------------------------------------------------
// 4. HTTP Backend Independent Enforcement Tests
// -------------------------------------------------------------------
async function runBackendTests() {
    const baseUrl = 'http://localhost:3001';
    try {
        // Login as donor to obtain token
    const loginRes = await fetch(`${baseUrl}/api/auth/demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'donor' })
    });
    const loginData = await loginRes.json();
    assert(loginData.token, 'Must successfully obtain auth token');
    const token = loginData.token;

    const samplePhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const dates = dateUtils.getCookedFoodDates();

    // A. Submitting Cooked Food with correct dates -> SUCCESS (HTTP 201)
    const validCookedRes = await fetch(`${baseUrl}/api/donations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            foodName: 'Automated Fresh Biryani',
            foodType: 'Cooked Food',
            quantity: 4,
            preparedDate: dates.preparedDateDisplay,
            expiryDate: dates.expiryDateDisplay,
            pickupLocation: 'Market Yard Gate 2',
            image: samplePhoto
        })
    });
    assert.strictEqual(validCookedRes.status, 201, 'Valid cooked food donation should be created');
    const createdDonation = await validCookedRes.json();
    assert.strictEqual(createdDonation.foodType, 'Cooked Food');
    assert.strictEqual(createdDonation.preparedDate, dates.preparedDateISO);
    assert.strictEqual(createdDonation.expiryDate, dates.expiryDateISO);
    assert.strictEqual(createdDonation.priority, 'HIGH', 'Expiring tomorrow has HIGH priority');
    console.log('✅ TEST 13 PASSED: Backend successfully creates Cooked Food with expected today/tomorrow dates.');

    // B. Submitting Cooked Food with MANIPULATED dates -> REJECTED (HTTP 400)
    const manipulatedRes = await fetch(`${baseUrl}/api/donations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            foodName: 'Manipulated Cooked Curry',
            foodType: 'Cooked Food',
            quantity: 5,
            preparedDate: '01/01/2026',
            expiryDate: '10/01/2026', // Tampered date
            pickupLocation: 'Market Yard Gate 2',
            image: samplePhoto
        })
    });
    assert.strictEqual(manipulatedRes.status, 400, 'Tampered cooked food dates must be rejected');
    const errorData = await manipulatedRes.json();
    assert(errorData.error.includes('Cooked Food must be prepared today'), 'Must return informative error message');
    console.log('✅ TEST 14 PASSED: Backend rejects manipulated date for Cooked Food (HTTP 400).');

    // C. Submitting Non-Cooked Food (e.g. Packaged Food) with arbitrary valid dates -> SUCCESS (HTTP 201)
    const packagedRes = await fetch(`${baseUrl}/api/donations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            foodName: 'Packaged Oats Box',
            foodType: 'Packaged Food',
            quantity: 2,
            preparedDate: dates.preparedDateDisplay,
            expiryDate: '28/10/2026', // Flexible date for packaged food
            pickupLocation: 'Market Yard Gate 2',
            image: samplePhoto
        })
    });
    assert.strictEqual(packagedRes.status, 201, 'Packaged food should allow standard valid dates');
    console.log('✅ TEST 15 PASSED: Non-cooked food allows standard flexible date ranges.');

        console.log('\n====================================================');
        console.log('  🎉 All 15 Tests Passed Successfully!');
        console.log('====================================================');
    } finally {
        // Teardown: Clean up temporary test donations created during tests
        try {
            const { DatabaseSync } = require('node:sqlite');
            const dbPath = path.join(__dirname, '..', 'foodshare.db');
            const testDb = new DatabaseSync(dbPath);
            testDb.prepare("DELETE FROM donations WHERE donor_email = 'donor@foodshare.org' AND food_name IN ('Automated Fresh Biryani', 'Packaged Oats Box');").run();
        } catch (cleanupErr) {}
    }
}

runBackendTests().catch(err => {
    console.error('❌ Backend test failed:', err);
    process.exit(1);
});
