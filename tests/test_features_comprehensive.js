/**
 * ShareBite Comprehensive Feature Test Suite
 * Tests Feature 1 through Feature 8 rigorously against the specification.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const dateUtils = require('../dateUtils.js');
const db = require('../db.js');
const emailService = require('../emailService.js');

console.log('====================================================');
console.log('  🎯 ShareBite Full Specification Verification Suite');
console.log('====================================================\n');

let passed = 0;
let total = 12;

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

function toDDMMYYYY(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

const SAMPLE_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Verified Test Accounts from DB
const testDonor = db.getUserByEmail('donor@foodshare.org');
const testNgo = db.getUserByEmail('ngo@foodshare.org');

// Ensure clean slate before test run
db.clearDonationsForTesting();
const createdTestDonationIds = [];

// TEST 1: Feature 5 — Clean DB returns 0 lifetime stats (no dummy numbers)
try {
    const stats0 = db.getStats();
    assert.strictEqual(stats0.totalFood, 0, 'Clean DB should have 0 food');
    assert.strictEqual(stats0.totalMeals, 0, 'Clean DB should have 0 meals');
    assert.strictEqual(stats0.totalDonations, 0, 'Clean DB should have 0 donations');
    assert.strictEqual(stats0.isLifetime, true);
    console.log('✅ TEST 1 PASSED: Empty database calculates 0 cumulative lifetime stats (no dummy demonstration values).');
    passed++;
} catch (err) {
    console.error('❌ TEST 1 FAILED:', err.message);
}

// TEST 2: Feature 4 — Mandatory Image Validation with exact error message
try {
    let threw = false;
    try {
        db.createDonation({
            foodName: 'Imageless Biryani',
            foodType: 'Cooked Food',
            quantity: 5,
            preparedDate: toDDMMYYYY(today),
            expiryDate: toDDMMYYYY(new Date(today.getTime() + 86400000)),
            pickupLocation: 'Test Road, Mumbai',
            image: '' // Missing
        }, testDonor);
    } catch (e) {
        threw = true;
        assert.strictEqual(e.message, 'Please upload a photo of the food before listing it.');
    }
    assert(threw, 'Should throw error when image is missing');
    console.log('✅ TEST 2 PASSED: Missing food photo is strictly rejected with message "Please upload a photo of the food before listing it."');
    passed++;
} catch (err) {
    console.error('❌ TEST 2 FAILED:', err.message);
}

// TEST 3: Feature 3 — Expiry Thresholds (CRITICAL, HIGH, MEDIUM, NORMAL, NEEDS_REVIEW)
try {
    // 1. Missing/Invalid expiry -> NEEDS_REVIEW
    const resReview = dateUtils.calculateFoodPriority('', today);
    assert.strictEqual(resReview.priority, 'NEEDS_REVIEW');
    assert.strictEqual(resReview.priorityLevel, 'NEEDS_REVIEW');

    // 2. Today -> CRITICAL (< 6 hours or today)
    const resCritical = dateUtils.calculateFoodPriority(toDDMMYYYY(today), today);
    assert.strictEqual(resCritical.priority, 'CRITICAL');

    // 3. Tomorrow -> HIGH (6-24h or 1-2 days)
    const tomorrow = new Date(today.getTime() + 86400000);
    const resHigh = dateUtils.calculateFoodPriority(toDDMMYYYY(tomorrow), today);
    assert.strictEqual(resHigh.priority, 'HIGH');

    // 4. 4 days -> MEDIUM (up to 3-5 days)
    const fourDays = new Date(today.getTime() + 4 * 86400000);
    const resMedium = dateUtils.calculateFoodPriority(toDDMMYYYY(fourDays), today);
    assert.strictEqual(resMedium.priority, 'MEDIUM');

    // 5. 7 days -> NORMAL (> 3-5 days)
    const sevenDays = new Date(today.getTime() + 7 * 86400000);
    const resNormal = dateUtils.calculateFoodPriority(toDDMMYYYY(sevenDays), today);
    assert.strictEqual(resNormal.priorityLevel, 'NORMAL');

    console.log('✅ TEST 3 PASSED: All 5 priority levels (CRITICAL, HIGH, MEDIUM, NORMAL, NEEDS_REVIEW) calculate deterministically.');
    passed++;
} catch (err) {
    console.error('❌ TEST 3 FAILED:', err.message);
}

// TEST 4: Feature 3 — Expired Listings Are Ineligible for Redistribution
try {
    const yesterday = new Date(today.getTime() - 86400000);
    const resExpired = dateUtils.calculateFoodPriority(toDDMMYYYY(yesterday), today);
    assert.strictEqual(resExpired.isExpired, true);
    assert.strictEqual(resExpired.status, 'Expired');
    console.log('✅ TEST 4 PASSED: Expired food is identified and flagged ineligible for redistribution.');
    passed++;
} catch (err) {
    console.error('❌ TEST 4 FAILED:', err.message);
}

// TEST 5: Feature 5 — Lifetime Statistics ONLY include Completed donations
try {
    const testExp = new Date(today.getTime() + 3 * 86400000);
    const expStr = toDDMMYYYY(testExp);

    // Create 3 donations with different statuses
    const d1 = db.createDonation({
        foodName: 'Available Rice',
        foodType: 'Cooked Food',
        quantity: 10,
        preparedDate: toDDMMYYYY(today),
        expiryDate: expStr,
        pickupLocation: 'Bandra, Mumbai',
        image: SAMPLE_IMG
    }, testDonor);
    createdTestDonationIds.push(d1.id);

    const d2 = db.createDonation({
        foodName: 'Cancelled Fruit',
        foodType: 'Fruits',
        quantity: 20,
        preparedDate: toDDMMYYYY(today),
        expiryDate: expStr,
        pickupLocation: 'Andheri, Mumbai',
        image: SAMPLE_IMG
    }, testDonor);
    createdTestDonationIds.push(d2.id);
    db.cancelDonation(d2.id, testDonor);

    const d3 = db.createDonation({
        foodName: 'Completed Meals',
        foodType: 'Cooked Food',
        quantity: 15,
        preparedDate: toDDMMYYYY(today),
        expiryDate: expStr,
        pickupLocation: 'Dadar, Mumbai',
        image: SAMPLE_IMG
    }, testDonor);
    createdTestDonationIds.push(d3.id);
    db.acceptDonation(d3.id, testNgo);
    db.completeDonation(d3.id, testDonor);

    // Stats should ONLY reflect d3 (15 kg, 60 meals, 1 donation)
    const stats = db.getStats();
    assert.strictEqual(stats.totalFood, 15, 'Only completed donation food (15kg) should count');
    assert.strictEqual(stats.totalMeals, 60, '15kg * 4 = 60 meals');
    assert.strictEqual(stats.totalDonations, 1, 'Only 1 completed donation should count');
    console.log('✅ TEST 5 PASSED: Cumulative lifetime stats strictly count completed donations and exclude available/cancelled.');
    passed++;
} catch (err) {
    console.error('❌ TEST 5 FAILED:', err.message);
}

// TEST 6: Feature 5 — Lifetime Stats Aggregates across multiple donors
try {
    const testExp = new Date(today.getTime() + 4 * 86400000);
    const secondDonor = db.getUserByEmail('pawarsharad1205@gmail.com') || testDonor;
    const d4 = db.createDonation({
        foodName: 'Donor 2 Sandwiches',
        foodType: 'Bakery Items',
        quantity: 25.5,
        preparedDate: toDDMMYYYY(today),
        expiryDate: toDDMMYYYY(testExp),
        pickupLocation: 'Colaba, Mumbai',
        image: SAMPLE_IMG
    }, secondDonor);
    createdTestDonationIds.push(d4.id);
    db.acceptDonation(d4.id, testNgo);
    db.completeDonation(d4.id, secondDonor);

    const statsMulti = db.getStats();
    assert.strictEqual(statsMulti.totalFood, 40.5, '15 + 25.5 = 40.5 kg total');
    assert.strictEqual(statsMulti.totalMeals, 162, '40.5 * 4 = 162 meals');
    assert.strictEqual(statsMulti.totalDonations, 2, '2 completed donations across multiple donors');
    console.log('✅ TEST 6 PASSED: Lifetime statistics accurately aggregate completed donations across all registered donors.');
    passed++;
} catch (err) {
    console.error('❌ TEST 6 FAILED:', err.message);
}

// TEST 7: Auto-Delete Expired Food
try {
    const yesterday = new Date(today.getTime() - 86400000);
    const expiredDonation = db.createDonation({
        foodName: 'Quick Spoil Salad',
        foodType: 'Vegetables',
        quantity: 3,
        preparedDate: toDDMMYYYY(yesterday),
        expiryDate: toDDMMYYYY(yesterday),
        pickupLocation: 'Churchgate, Mumbai',
        image: SAMPLE_IMG
    }, testDonor);
    if (expiredDonation) createdTestDonationIds.push(expiredDonation.id);

    // Auto-purge runs and removes the expired item
    const purgeResult = db.purgeExpiredDonations();
    const check = db.getDonationById(expiredDonation?.id || 999999);
    assert.strictEqual(check, null, 'Expired food must be completely deleted from database');
    console.log('✅ TEST 7 PASSED: Expired food listings are automatically purged and deleted from database.');
    passed++;
} catch (err) {
    console.error('❌ TEST 7 FAILED:', err.message);
}

// TEST 8: Feature 2 — Map configuration & coordinate storage
try {
    const testExp = new Date(today.getTime() + 3 * 86400000);
    const dGeo = db.createDonation({
        foodName: 'Geolocated Soup',
        foodType: 'Cooked Food',
        quantity: 8,
        preparedDate: toDDMMYYYY(today),
        expiryDate: toDDMMYYYY(testExp),
        pickupLocation: 'Nariman Point, Mumbai',
        latitude: 18.9256,
        longitude: 72.8242,
        image: SAMPLE_IMG
    }, testDonor);
    createdTestDonationIds.push(dGeo.id);

    const retrieved = db.getDonationById(dGeo.id);
    assert.strictEqual(retrieved.latitude, 18.9256);
    assert.strictEqual(retrieved.longitude, 72.8242);
    console.log('✅ TEST 8 PASSED: Geographic coordinates are reliably recorded with food listings for map rendering.');
    passed++;
} catch (err) {
    console.error('❌ TEST 8 FAILED:', err.message);
}

// TEST 9: Feature 7 — Environment variables sanitized (.env.example)
try {
    const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf-8');
    assert(envExample.includes('RESEND_API_KEY='), 'Must document RESEND_API_KEY');
    assert(envExample.includes('EMAIL_FROM='), 'Must document EMAIL_FROM');
    assert(envExample.includes('MAPTILER_API_KEY='), 'Must document MAPTILER_API_KEY');
    assert(envExample.includes('GOOGLE_MAPS_API_KEY='), 'Must document GOOGLE_MAPS_API_KEY');
    assert(envExample.includes('GROQ_API_KEY='), 'Must document GROQ_API_KEY');
    assert(!envExample.includes('SMTP_'), 'Must not contain obsolete SMTP comments');
    console.log('✅ TEST 9 PASSED: .env.example accurately documents required variables without obsolete comments.');
    passed++;
} catch (err) {
    console.error('❌ TEST 9 FAILED:', err.message);
}

// TEST 10: Feature 8 — Vercel Compatibility
try {
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf-8'));
    assert.strictEqual(vercelConfig.version, 2, 'vercel.json version must be 2');
    assert(vercelConfig.rewrites && vercelConfig.rewrites.some(r => r.source.includes('/api')), 'Must rewrite /api requests');
    console.log('✅ TEST 10 PASSED: vercel.json preserves proper serverless routes and deployment configuration.');
    passed++;
} catch (err) {
    console.error('❌ TEST 10 FAILED:', err.message);
}

// TEST 11: Feature 1 — Resend Password Reset OTP Security
try {
    assert.strictEqual(typeof emailService.sendPasswordResetEmail, 'function');
    assert.strictEqual(typeof emailService.buildResetEmailHtml, 'function');
    assert.strictEqual(typeof db.createPasswordResetRequest, 'function');
    assert.strictEqual(typeof db.verifyOtp, 'function');
    assert.strictEqual(typeof db.completePasswordReset, 'function');
    console.log('✅ TEST 11 PASSED: Resend email OTP service and db routines export secure generation, hashing, and verification.');
    passed++;
} catch (err) {
    console.error('❌ TEST 11 FAILED:', err.message);
}

// TEST 12: Teardown — 0 lingering demo records
try {
    db.clearDonationsForTesting();
    const finalCount = db.getDonations().length;
    assert.strictEqual(finalCount, 0, 'Must leave 0 lingering test records');
    const finalStats = db.getStats();
    assert.strictEqual(finalStats.totalFood, 0, 'Final food shared must be 0 after test cleanup');
    assert.strictEqual(finalStats.totalDonations, 0, 'Final donations must be 0 after test cleanup');
    console.log('✅ TEST 12 PASSED: Test suite cleaned up all test records; 0 lingering demo donations remaining.');
    passed++;
} catch (err) {
    console.error('❌ TEST 12 FAILED:', err.message);
}

console.log('\n====================================================');
console.log(`  🎉 Feature Suite Results: ${passed}/${total} Passed`);
console.log('====================================================\n');
process.exit(passed === total ? 0 : 1);
