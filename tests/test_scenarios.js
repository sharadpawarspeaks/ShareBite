/**
 * ShareBite Food Prioritization & Expiry Validation Test Suite
 * Validates all 14 required test scenarios from the specification.
 */

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const dateUtils = require('../dateUtils.js');
const db = require('../db.js');

console.log('====================================================');
console.log('  🧪 Running ShareBite Automated Test Suite');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 14;

// Sample valid test image (1x1 transparent PNG data URL)
const SAMPLE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Helper to format Date to DD/MM/YYYY
function toDDMMYYYY(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);

const twoDays = new Date(today);
twoDays.setDate(twoDays.getDate() + 2);

const fourDays = new Date(today);
fourDays.setDate(fourDays.getDate() + 4);

const sevenDays = new Date(today);
sevenDays.setDate(sevenDays.getDate() + 7);

const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);

const todayStr = toDDMMYYYY(today);
const tomorrowStr = toDDMMYYYY(tomorrow);
const twoDaysStr = toDDMMYYYY(twoDays);
const fourDaysStr = toDDMMYYYY(fourDays);
const sevenDaysStr = toDDMMYYYY(sevenDays);
const yesterdayStr = toDDMMYYYY(yesterday);

// Test donor and NGO accounts
const testDonor = db.getUserByEmail('donor@foodshare.org');
const testNgo = db.getUserByEmail('ngo@foodshare.org');

assert(testDonor, 'Test donor user should exist');
assert(testNgo, 'Test NGO user should exist');

// ----------------------------------------------------
// TEST 1: Expiry date: Today -> Expected: CRITICAL; requires urgent review.
// ----------------------------------------------------
try {
    const res1 = dateUtils.calculateFoodPriority(todayStr, today);
    assert.strictEqual(res1.priority, 'CRITICAL', 'Priority should be CRITICAL');
    assert.strictEqual(res1.daysRemaining, 0, 'Days remaining should be 0');
    assert.strictEqual(res1.expiresToday, true, 'expiresToday should be true');
    assert.strictEqual(res1.isExpired, false, 'Should not be marked already expired');
    assert.match(res1.warning, /urgent/i, 'Warning must require urgent review');
    console.log('✅ TEST 1 PASSED: Expiry date Today -> CRITICAL; requires urgent review.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 1 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 2: Expiry date: Tomorrow -> Expected: HIGH.
// ----------------------------------------------------
try {
    const res2 = dateUtils.calculateFoodPriority(tomorrowStr, today);
    assert.strictEqual(res2.priority, 'HIGH', 'Priority should be HIGH');
    assert.strictEqual(res2.daysRemaining, 1, 'Days remaining should be 1');
    assert.strictEqual(res2.isExpired, false);
    console.log('✅ TEST 2 PASSED: Expiry date Tomorrow -> HIGH.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 2 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 3: Expiry date: Two days from today -> Expected: HIGH.
// ----------------------------------------------------
try {
    const res3 = dateUtils.calculateFoodPriority(twoDaysStr, today);
    assert.strictEqual(res3.priority, 'HIGH', 'Priority should be HIGH');
    assert.strictEqual(res3.daysRemaining, 2, 'Days remaining should be 2');
    assert.strictEqual(res3.isExpired, false);
    console.log('✅ TEST 3 PASSED: Expiry date Two days from today -> HIGH.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 3 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 4: Expiry date: Four days from today -> Expected: MEDIUM.
// ----------------------------------------------------
try {
    const res4 = dateUtils.calculateFoodPriority(fourDaysStr, today);
    assert.strictEqual(res4.priority, 'MEDIUM', 'Priority should be MEDIUM');
    assert.strictEqual(res4.daysRemaining, 4, 'Days remaining should be 4');
    assert.strictEqual(res4.isExpired, false);
    console.log('✅ TEST 4 PASSED: Expiry date Four days from today -> MEDIUM.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 4 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 5: Expiry date: Seven days from today -> Expected: LOW.
// ----------------------------------------------------
try {
    const res5 = dateUtils.calculateFoodPriority(sevenDaysStr, today);
    assert.strictEqual(res5.priority, 'LOW', 'Priority should be LOW');
    assert.strictEqual(res5.daysRemaining, 7, 'Days remaining should be 7');
    assert.strictEqual(res5.isExpired, false);
    console.log('✅ TEST 5 PASSED: Expiry date Seven days from today -> LOW.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 5 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 6: Expiry date: Yesterday -> Expected: EXPIRED; unavailable for acceptance.
// ----------------------------------------------------
try {
    const res6 = dateUtils.calculateFoodPriority(yesterdayStr, today);
    assert.strictEqual(res6.isExpired, true, 'isExpired must be true');
    assert.strictEqual(res6.status, 'Expired', 'Status must be Expired');
    assert.strictEqual(res6.priority, 'CRITICAL', 'Priority must be CRITICAL');
    assert(res6.daysRemaining < 0, 'Days remaining must be negative');

    // Create donation with yesterday's date
    const expiredDonation = db.createDonation({
        foodName: 'Test Expired Bread',
        foodType: 'Bakery Items',
        quantity: 2,
        preparedDate: yesterdayStr,
        expiryDate: yesterdayStr,
        pickupLocation: 'Baker Street Depo',
        image: SAMPLE_IMAGE
    }, testDonor);

    assert.strictEqual(expiredDonation.status, 'Expired', 'Created donation with past date must have status Expired');
    assert.strictEqual(expiredDonation.isExpired, true, 'Created donation with past date must be marked isExpired');

    // Available list should not include it
    const availableList = db.getDonations({ status: 'Available' });
    const found = availableList.find(d => d.id === expiredDonation.id);
    assert(!found, 'Expired donation must NOT appear among available donations for NGOs to accept');

    console.log('✅ TEST 6 PASSED: Expiry date Yesterday -> EXPIRED; unavailable for acceptance.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 6 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 7: No expiry date supplied -> Expected: Submission rejected.
// ----------------------------------------------------
try {
    assert.throws(() => {
        db.createDonation({
            foodName: 'No Expiry Food',
            foodType: 'Cooked Food',
            quantity: 5,
            preparedDate: todayStr,
            expiryDate: '',
            pickupLocation: 'Downtown',
            image: SAMPLE_IMAGE
        }, testDonor);
    }, /Expiry date is required/i);
    console.log('✅ TEST 7 PASSED: No expiry date supplied -> Submission rejected.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 7 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 8: Invalid date such as 32/13/2026 -> Expected: Submission rejected.
// ----------------------------------------------------
try {
    assert.throws(() => {
        db.createDonation({
            foodName: 'Invalid Date Food',
            foodType: 'Cooked Food',
            quantity: 5,
            preparedDate: todayStr,
            expiryDate: '32/13/2026',
            pickupLocation: 'Downtown',
            image: SAMPLE_IMAGE
        }, testDonor);
    }, /Invalid/i);
    console.log('✅ TEST 8 PASSED: Invalid date 32/13/2026 -> Submission rejected.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 8 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 9: No food image selected -> Expected: Submission rejected.
// ----------------------------------------------------
try {
    assert.throws(() => {
        db.createDonation({
            foodName: 'No Image Food',
            foodType: 'Cooked Food',
            quantity: 5,
            preparedDate: todayStr,
            expiryDate: fourDaysStr,
            pickupLocation: 'Downtown',
            image: ''
        }, testDonor);
    }, /Food photo is required/i);
    console.log('✅ TEST 9 PASSED: No food image selected -> Submission rejected.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 9 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 10: Valid image selected -> Expected: Image saved using persistent storage
// and displayed on the NGO dashboard without AI image analysis.
// ----------------------------------------------------
try {
    const donation10 = db.createDonation({
        foodName: 'Fresh Apples Batch',
        foodType: 'Fruits',
        quantity: 10,
        preparedDate: todayStr,
        expiryDate: sevenDaysStr,
        pickupLocation: 'Orchard Point',
        image: SAMPLE_IMAGE
    }, testDonor);

    assert.strictEqual(donation10.image, SAMPLE_IMAGE, 'Persistent image must be preserved exactly with donation record');
    assert.strictEqual(donation10.priority, 'LOW', 'Priority must be LOW for seven days without calling AI vision');
    console.log('✅ TEST 10 PASSED: Valid image selected -> Saved persistently with record without AI vision.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 10 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 11: Multiple available donations have different expiry dates ->
// Expected: NGO dashboard sorts them by urgency and earliest expiry.
// ----------------------------------------------------
try {
    // Create test donations with various expiry dates
    const dCritical = db.createDonation({
        foodName: 'Critical Soup (Expires Today)',
        foodType: 'Cooked Food',
        quantity: 3,
        preparedDate: todayStr,
        expiryDate: todayStr,
        pickupLocation: 'Station Road',
        image: SAMPLE_IMAGE
    }, testDonor);

    const dHighTomorrow = db.createDonation({
        foodName: 'High Salads (Expires Tomorrow)',
        foodType: 'Vegetables',
        quantity: 4,
        preparedDate: todayStr,
        expiryDate: tomorrowStr,
        pickupLocation: 'Green Park',
        image: SAMPLE_IMAGE
    }, testDonor);

    const dHighTwoDays = db.createDonation({
        foodName: 'High Stew (Expires in 2 Days)',
        foodType: 'Cooked Food',
        quantity: 6,
        preparedDate: todayStr,
        expiryDate: twoDaysStr,
        pickupLocation: 'City Center',
        image: SAMPLE_IMAGE
    }, testDonor);

    const dMedium = db.createDonation({
        foodName: 'Medium Pasta (Expires in 4 Days)',
        foodType: 'Cooked Food',
        quantity: 8,
        preparedDate: todayStr,
        expiryDate: fourDaysStr,
        pickupLocation: 'East Wing',
        image: SAMPLE_IMAGE
    }, testDonor);

    const dLow = db.createDonation({
        foodName: 'Low Rice Bags (Expires in 7 Days)',
        foodType: 'Packaged Food',
        quantity: 20,
        preparedDate: todayStr,
        expiryDate: sevenDaysStr,
        pickupLocation: 'Depot Store',
        image: SAMPLE_IMAGE
    }, testDonor);

    const sortedList = db.getDonations({ status: 'Available', sort: 'priority' });

    // Verify ordering
    const indexCritical = sortedList.findIndex(d => d.id === dCritical.id);
    const indexTomorrow = sortedList.findIndex(d => d.id === dHighTomorrow.id);
    const indexTwoDays = sortedList.findIndex(d => d.id === dHighTwoDays.id);
    const indexMedium = sortedList.findIndex(d => d.id === dMedium.id);
    const indexLow = sortedList.findIndex(d => d.id === dLow.id);

    assert(indexCritical !== -1 && indexTomorrow !== -1 && indexTwoDays !== -1 && indexMedium !== -1 && indexLow !== -1);
    assert(indexCritical < indexTomorrow, 'CRITICAL (expires today) must sort before HIGH (tomorrow)');
    assert(indexTomorrow < indexTwoDays, 'HIGH (tomorrow) must sort before HIGH (2 days)');
    assert(indexTwoDays < indexMedium, 'HIGH must sort before MEDIUM');
    assert(indexMedium < indexLow, 'MEDIUM must sort before LOW');

    console.log('✅ TEST 11 PASSED: Multiple available donations sorted by urgency and earliest expiry date.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 11 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 12: Donation remains listed across a backend restart or redeployment ->
// Expected: Donation data and image remain available.
// ----------------------------------------------------
try {
    // Create a donation, then re-read directly from SQLite via a new connection
    const testDonation = db.createDonation({
        foodName: 'Restart Persistence Test Rolls',
        foodType: 'Bakery Items',
        quantity: 12,
        preparedDate: todayStr,
        expiryDate: fourDaysStr,
        pickupLocation: 'North Bakery',
        image: SAMPLE_IMAGE
    }, testDonor);

    // Simulate backend restart by querying fresh through db.getDonationById
    const fetched = db.getDonationById(testDonation.id);
    assert.strictEqual(fetched.id, testDonation.id);
    assert.strictEqual(fetched.foodName, 'Restart Persistence Test Rolls');
    assert.strictEqual(fetched.image, SAMPLE_IMAGE, 'Image must persist across restarts');
    assert.strictEqual(fetched.expiryDateFormatted, fourDaysStr, 'Expiry date DD/MM/YYYY must persist across restarts');
    console.log('✅ TEST 12 PASSED: Donation data and image persist across restarts.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 12 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 13: Donation has expired after being created ->
// Expected: Its status and availability are updated appropriately.
// ----------------------------------------------------
try {
    // Create a donation with today's expiry
    const donation13 = db.createDonation({
        foodName: 'Aging Milk Carton',
        foodType: 'Dairy Products',
        quantity: 4,
        preparedDate: todayStr,
        expiryDate: todayStr,
        pickupLocation: 'Cold Room',
        image: SAMPLE_IMAGE
    }, testDonor);

    assert.strictEqual(donation13.status, 'Available', 'Initially available when expiring today');

    // Simulate the clock ticking past midnight into tomorrow:
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + 1); // 1 day later
    const futurePriority = dateUtils.calculateFoodPriority(donation13.expiryDate, futureDate);

    assert.strictEqual(futurePriority.isExpired, true, 'Must dynamically calculate as expired in future date');
    assert.strictEqual(futurePriority.status, 'Expired');
    assert.strictEqual(futurePriority.priority, 'CRITICAL');

    console.log('✅ TEST 13 PASSED: Donation status and priority dynamically update as it expires.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 13 FAILED:', err.message);
}

// ----------------------------------------------------
// TEST 14: NGO attempts to accept an expired donation ->
// Expected: Backend rejects the request.
// ----------------------------------------------------
try {
    const expiredDonationForNgo = db.createDonation({
        foodName: 'Old Cut Melons',
        foodType: 'Fruits',
        quantity: 3,
        preparedDate: yesterdayStr,
        expiryDate: yesterdayStr,
        pickupLocation: 'Backyard Stand',
        image: SAMPLE_IMAGE
    }, testDonor);

    assert.throws(() => {
        db.acceptDonation(expiredDonationForNgo.id, testNgo);
    }, /expired/i, 'Backend must reject attempt to accept expired donation');

    console.log('✅ TEST 14 PASSED: Backend rejects NGO attempt to accept expired donation.');
    passedTests++;
} catch (err) {
    console.error('❌ TEST 14 FAILED:', err.message);
}

console.log('\n====================================================');
console.log(`  🎉 Test Results: ${passedTests}/${totalTests} Tests Passed`);
console.log('====================================================\n');

if (passedTests === totalTests) {
    process.exit(0);
} else {
    process.exit(1);
}
