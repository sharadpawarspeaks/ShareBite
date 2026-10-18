const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const dateUtils = require('../dateUtils.js');

console.log('====================================================');
console.log('  🧪 ShareBite Food Listing & Landing Page Verification Suite');
console.log('====================================================\n');

const baseUrl = 'http://localhost:3001';
const SAMPLE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function runTests() {
    let createdDonationId = null;
    let testDonorEmail = `real.donor.${Date.now()}@example.com`;
    let testNgoEmail = `real.ngo.${Date.now()}@example.com`;

    try {
        // ----------------------------------------------------
        // TEST 1: Register new donor and submit genuine donation
        // ----------------------------------------------------
        console.log('--- TEST 1: Register New Donor & Submit Genuine Donation ---');
        const donorSignupRes = await fetch(`${baseUrl}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Kavita Sharma',
                email: testDonorEmail,
                password: 'Password@123',
                role: 'donor'
            })
        });
        assert.strictEqual(donorSignupRes.status, 201, 'Donor signup should succeed (201)');
        const donorData = await donorSignupRes.json();
        const donorToken = donorData.token;
        assert(donorToken, 'Must receive auth token for registered donor');

        const cookedDates = dateUtils.getCookedFoodDates();
        const donationRes = await fetch(`${baseUrl}/api/donations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${donorToken}`
            },
            body: JSON.stringify({
                foodName: 'Kavita Fresh Vegetable Pulao',
                foodType: 'Cooked Food',
                quantity: 15,
                preparedDate: cookedDates.preparedDateDisplay,
                expiryDate: cookedDates.expiryDateDisplay,
                pickupLocation: 'Shivaji Nagar Community Hall',
                image: SAMPLE_IMAGE
            })
        });
        assert.strictEqual(donationRes.status, 201, 'Genuine donation should be created (201)');
        const createdDonation = await donationRes.json();
        createdDonationId = createdDonation.id;
        assert.strictEqual(createdDonation.foodName, 'Kavita Fresh Vegetable Pulao');
        assert.strictEqual(createdDonation.donorName, 'Kavita Sharma');
        assert.strictEqual(createdDonation.status, 'Available');
        console.log('✅ TEST 1 PASSED: Registered new donor and submitted genuine donation successfully.');

        // ----------------------------------------------------
        // TEST 2: Log in using different NGO account to see donations from ALL donors
        // ----------------------------------------------------
        console.log('--- TEST 2: NGO Views Donations from All Registered Donors ---');
        const ngoSignupRes = await fetch(`${baseUrl}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Seva Foundation NGO',
                email: testNgoEmail,
                password: 'Password@123',
                role: 'ngo'
            })
        });
        assert.strictEqual(ngoSignupRes.status, 201, 'NGO signup should succeed');
        const ngoData = await ngoSignupRes.json();
        const ngoToken = ngoData.token;

        const allDonationsRes = await fetch(`${baseUrl}/api/donations`);
        assert.strictEqual(allDonationsRes.status, 200);
        const allDonations = await allDonationsRes.json();
        const found = allDonations.find(d => d.id === createdDonationId);
        assert(found, 'Donation submitted by donor Kavita Sharma must be visible to NGO');
        assert.strictEqual(found.donorName, 'Kavita Sharma');
        assert.strictEqual(found.status, 'Available');
        console.log('✅ TEST 2 PASSED: NGO sees eligible donation from registered donor (not filtered by current user).');

        // ----------------------------------------------------
        // TEST 3: Landing page Recently Donated Food reflects real data
        // ----------------------------------------------------
        console.log('--- TEST 3: Landing Page Displays Real Donations ---');
        const availableOnlyRes = await fetch(`${baseUrl}/api/donations?status=Available`);
        assert.strictEqual(availableOnlyRes.status, 200);
        const availableDonations = await availableOnlyRes.json();
        const landingItem = availableDonations.find(d => d.id === createdDonationId);
        assert(landingItem, 'Genuine donation appears in available food list');
        assert.strictEqual(landingItem.foodName, 'Kavita Fresh Vegetable Pulao');
        assert.strictEqual(landingItem.quantity, 15);
        assert.strictEqual(landingItem.foodType, 'Cooked Food');
        assert.strictEqual(landingItem.priority, 'HIGH');
        assert.strictEqual(landingItem.donorName, 'Kavita Sharma');
        console.log('✅ TEST 3 PASSED: Landing page feed includes genuine donation with real donor name and attributes.');

        // ----------------------------------------------------
        // TEST 4: Empty state validation when no eligible donations exist
        // ----------------------------------------------------
        console.log('--- TEST 4: Empty State Validation ---');
        const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        const js = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
        assert(html.includes('id="recentFoodSection"'), 'Landing page must contain recentFoodSection');
        assert(html.includes('id="recentFoodContainer"'), 'Must contain recentFoodContainer');
        assert(html.includes('id="recentFoodFooter"'), 'Must contain recentFoodFooter');
        assert(html.includes('id="btnViewAllFood"'), 'Must contain View All Food button');
        assert(js.includes('No food donations available right now.'), 'script.js must contain required empty-state title');
        assert(js.includes('Be the first to share food with your community.'), 'script.js must contain required empty-state subtitle');
        assert(js.includes('openRoleModal(\'donor\')'), 'Empty state must include Donate Food button');
        console.log('✅ TEST 4 PASSED: Empty state strings and actions verified in code.');

        // ----------------------------------------------------
        // TEST 5: Backend / Network Error Handling
        // ----------------------------------------------------
        console.log('--- TEST 5: Error Handling Without Fake Fallback ---');
        assert(js.includes('function renderLandingError()'), 'script.js must contain renderLandingError');
        assert(js.includes('Unable to connect to database'), 'Error state must display informative error message');
        assert(js.includes('Retry Connection'), 'Error state must allow user to retry');
        assert(!js.includes('Automated Fresh Biryani'), 'script.js must NOT contain hardcoded fallback food items');
        assert(!js.includes('Packaged Oats Box'), 'script.js must NOT contain mock oats box in code');
        console.log('✅ TEST 5 PASSED: Error state verified and zero fake food fallbacks present.');

        // ----------------------------------------------------
        // TEST 6: Donor Name Comes from Real Registered User
        // ----------------------------------------------------
        console.log('--- TEST 6: Donor Name Comes from Actual User ---');
        const db = require('../db.js');
        const dbDonation = db.getDonationById(createdDonationId);
        assert.strictEqual(dbDonation.donorName, 'Kavita Sharma', 'Donor name must match registered user');
        assert.strictEqual(dbDonation.donorEmail, testDonorEmail, 'Donor email must match registered user');
        console.log('✅ TEST 6 PASSED: Real donor display name correctly resolved through database relationship.');

        // ----------------------------------------------------
        // TEST 7: Expiry-Based Priority Calculation
        // ----------------------------------------------------
        console.log('--- TEST 7: Expiry-Based Priority Calculation ---');
        assert.strictEqual(dbDonation.priority, 'HIGH', 'Cooked food expiring in 1 day must have priority HIGH');
        assert.strictEqual(dbDonation.daysRemaining, 1, 'Days remaining must be 1 day');
        console.log('✅ TEST 7 PASSED: Expiry priority calculated strictly from expiry date.');

        // ----------------------------------------------------
        // TEST 8: Landing Page Statistics Reflect Database
        // ----------------------------------------------------
        console.log('--- TEST 8: Landing Page Statistics ---');
        const statsRes = await fetch(`${baseUrl}/api/stats`);
        assert.strictEqual(statsRes.status, 200);
        const stats = await statsRes.json();
        assert(typeof stats.totalFood === 'number', 'totalFood must be a number');
        assert(typeof stats.totalMeals === 'number', 'totalMeals must be a number');
        assert(typeof stats.totalDonations === 'number', 'totalDonations must be a number');
        // Uncompleted donations must NOT count as completed food
        const dbStats = db.getStats();
        assert.strictEqual(stats.totalFood, dbStats.totalFood);
        assert.strictEqual(stats.totalMeals, dbStats.totalMeals);
        assert.strictEqual(stats.totalDonations, dbStats.totalDonations);
        console.log(`✅ TEST 8 PASSED: Real stats verified (Food Shared: ${stats.totalFood} kg, Meals: ${stats.totalMeals}, Completed: ${stats.totalDonations}).`);

        // ----------------------------------------------------
        // TEST 9: Existing Functionality Intact (NGO Claim & Complete)
        // ----------------------------------------------------
        console.log('--- TEST 9: Existing Lifecycle Functionality ---');
        const acceptRes = await fetch(`${baseUrl}/api/donations/${createdDonationId}/accept`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ngoToken}`
            }
        });
        assert.strictEqual(acceptRes.status, 200, 'NGO should be able to accept donation');
        const acceptedDonation = await acceptRes.json();
        assert.strictEqual(acceptedDonation.status, 'Accepted');
        assert.strictEqual(acceptedDonation.acceptedByName, 'Seva Foundation NGO');

        const completeRes = await fetch(`${baseUrl}/api/donations/${createdDonationId}/complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ngoToken}`
            }
        });
        assert.strictEqual(completeRes.status, 200, 'NGO should be able to complete donation');
        const completedDonation = await completeRes.json();
        assert.strictEqual(completedDonation.status, 'Completed');
        console.log('✅ TEST 9 PASSED: Complete donation claiming and redistribution lifecycle validated.');

        console.log('\n====================================================');
        console.log('  🎉 All 9 Requirements & Scenarios Passed Successfully!');
        console.log('====================================================');
    } finally {
        // Teardown: Safely clean up only the test records created in this run
        try {
            const dbPath = path.join(__dirname, '..', 'foodshare.db');
            const testDb = new DatabaseSync(dbPath);
            if (createdDonationId) {
                testDb.prepare('DELETE FROM donations WHERE id = ?;').run(createdDonationId);
            }
            testDb.prepare('DELETE FROM users WHERE email IN (?, ?);').run(testDonorEmail, testNgoEmail);
            testDb.prepare('DELETE FROM notifications WHERE user_email IN (?, ?);').run(testDonorEmail, testNgoEmail);
            console.log('🧹 Cleaned up temporary test data cleanly.');
        } catch (cleanupErr) {
            console.warn('Cleanup warning:', cleanupErr.message);
        }
    }
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
