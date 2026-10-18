/**
 * ShareBite Automated Test Suite
 * Covers Part 4 Requirements:
 * 1. Accurate Landing Page Statistics across all users (Food Shared, Meals Supported, Donations)
 * 2. Login Session Persistence across Page Refreshes, Navigation, and Logout
 */

const assert = require('node:assert');
const path = require('node:path');
const db = require('../db.js');

const baseUrl = 'http://localhost:3001';

async function runTests() {
    console.log('====================================================');
    console.log('  🧪 Running Statistics & Session Persistence Test Suite');
    console.log('====================================================\n');

    let passed = 0;
    const total = 11;
    const testDonationIds = [];
    const testUserIds = [];

    const SAMPLE_IMG = 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80';

    try {
        // Baseline stats
        const initialStats = db.getStats();

        // -----------------------------------------------------------------
        // TEST 1: Submit Real Donation as Donor 1 & Confirm in Database
        // -----------------------------------------------------------------
        console.log('--- TEST 1: Submit Real Donation as Donor 1 ---');
        const donor1Email = `donor1_${Date.now()}@test.org`;
        const donor1 = db.createUser('Alice Donor', donor1Email, 'pass1234', 'donor');
        testUserIds.push(donor1.id);
        const donor1Token = db.createSession(donor1.id);

        const donation1Res = await fetch(`${baseUrl}/api/donations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${donor1Token}`
            },
            body: JSON.stringify({
                foodName: 'Test Fresh Apples',
                foodType: 'Fruits',
                quantity: 10,
                preparedDate: '18/10/2026',
                expiryDate: '25/10/2026',
                pickupLocation: 'Bandra, Mumbai',
                image: SAMPLE_IMG
            })
        });
        assert.strictEqual(donation1Res.status, 201);
        const d1 = await donation1Res.json();
        testDonationIds.push(d1.id);
        assert(d1.id, 'Donation 1 must be created and returned with an ID');
        console.log('✅ TEST 1 PASSED: Donation successfully created and stored in DB.');
        passed++;

        // -----------------------------------------------------------------
        // TEST 2: Public Landing Stats Reflects Uncompleted Submissions
        // -----------------------------------------------------------------
        console.log('--- TEST 2: Public Landing Stats Reflects Uncompleted Submissions ---');
        const statsRes1 = await fetch(`${baseUrl}/api/stats`);
        assert.strictEqual(statsRes1.status, 200);
        const stats1 = await statsRes1.json();
        assert.strictEqual(stats1.totalDonations, initialStats.totalDonations + 1, 'Total donations metric must include new available donation');
        assert.strictEqual(stats1.totalFood, initialStats.totalFood, 'Food shared must NOT count available donations (only completed)');
        assert.strictEqual(stats1.totalMeals, initialStats.totalMeals, 'Meals supported must NOT count available donations');
        console.log('✅ TEST 2 PASSED: Landing page counts newly submitted donation without miscounting available food as redistributed.');
        passed++;

        // -----------------------------------------------------------------
        // TEST 3: Multiple Donors Included in Global Statistics
        // -----------------------------------------------------------------
        console.log('--- TEST 3: Multiple Donors Included in Global Statistics ---');
        const donor2Email = `donor2_${Date.now()}@test.org`;
        const donor2 = db.createUser('Bob Baker', donor2Email, 'pass1234', 'donor');
        testUserIds.push(donor2.id);
        const donor2Token = db.createSession(donor2.id);

        const donation2Res = await fetch(`${baseUrl}/api/donations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${donor2Token}`
            },
            body: JSON.stringify({
                foodName: 'Test Fresh Bagels',
                foodType: 'Bakery Items',
                quantity: 20,
                preparedDate: '18/10/2026',
                expiryDate: '21/10/2026',
                pickupLocation: 'Andheri, Mumbai',
                image: SAMPLE_IMG
            })
        });
        assert.strictEqual(donation2Res.status, 201);
        const d2 = await donation2Res.json();
        testDonationIds.push(d2.id);

        const statsRes2 = await fetch(`${baseUrl}/api/stats`);
        const stats2 = await statsRes2.json();
        assert.strictEqual(stats2.totalDonations, initialStats.totalDonations + 2, 'Donations from multiple donors must aggregate into global stats');
        console.log('✅ TEST 3 PASSED: Multiple distinct donors correctly aggregate into global stats.');
        passed++;

        // -----------------------------------------------------------------
        // TEST 4: Redistribution Lifecycle: Accept and Complete Donation
        // -----------------------------------------------------------------
        console.log('--- TEST 4: Complete Donation Updates Food Shared and Meals Supported ---');
        const ngoEmail = `ngo_tester_${Date.now()}@test.org`;
        const ngoUser = db.createUser('Care Food NGO', ngoEmail, 'pass1234', 'ngo');
        testUserIds.push(ngoUser.id);
        const ngoToken = db.createSession(ngoUser.id);

        // NGO accepts d1
        const acceptRes = await fetch(`${baseUrl}/api/donations/${d1.id}/accept`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ngoToken}` }
        });
        assert.strictEqual(acceptRes.status, 200);

        // NGO completes d1 (10 kg)
        const completeRes = await fetch(`${baseUrl}/api/donations/${d1.id}/complete`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${ngoToken}` }
        });
        assert.strictEqual(completeRes.status, 200);

        const statsRes3 = await fetch(`${baseUrl}/api/stats`);
        const stats3 = await statsRes3.json();
        assert.strictEqual(stats3.totalFood, Number((initialStats.totalFood + 10).toFixed(1)), 'Food Shared must increase by 10 kg');
        assert.strictEqual(stats3.totalMeals, initialStats.totalMeals + 40, 'Meals Supported must increase by 40 (10kg * 4 meals/kg)');
        assert.strictEqual(stats3.totalDonations, initialStats.totalDonations + 2, 'Total donations remains 2 (no duplicate counting)');
        console.log('✅ TEST 4 PASSED: Food Shared and Meals Supported correctly update upon completion without duplicate donation counting.');
        passed++;

        // -----------------------------------------------------------------
        // TEST 5: Cancelled Donations Excluded from Statistics
        // -----------------------------------------------------------------
        console.log('--- TEST 5: Cancelled Donations Excluded from Statistics ---');
        // Cancel d2 by donor2
        const cancelRes = await fetch(`${baseUrl}/api/donations/${d2.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${donor2Token}` }
        });
        assert.strictEqual(cancelRes.status, 200);

        const statsRes4 = await fetch(`${baseUrl}/api/stats`);
        const stats4 = await statsRes4.json();
        assert.strictEqual(stats4.totalDonations, initialStats.totalDonations + 1, 'Cancelled donation is excluded from active total');
        console.log('✅ TEST 5 PASSED: Cancelled donations correctly excluded from totals.');
        passed++;

        // -----------------------------------------------------------------
        // TEST 6: Authentication Session Restoration (GET /api/auth/me)
        // -----------------------------------------------------------------
        console.log('--- TEST 6: Session Restoration on Refresh (GET /api/auth/me) ---');
        const authMeRes = await fetch(`${baseUrl}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${donor1Token}` }
        });
        assert.strictEqual(authMeRes.status, 200);
        const authData = await authMeRes.json();
        assert.strictEqual(authData.user.id, donor1.id);
        assert.strictEqual(authData.user.email, donor1Email);
        assert.strictEqual(authData.user.role, 'donor');
        console.log('✅ TEST 6 PASSED: Backend restores donor session accurately across refreshes.');
        passed++;

        // -----------------------------------------------------------------
        // TEST 7: NGO Session Restoration and Role Preservation
        // -----------------------------------------------------------------
        console.log('--- TEST 7: NGO Role Restoration on Refresh ---');
        const ngoAuthRes = await fetch(`${baseUrl}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${ngoToken}` }
        });
        assert.strictEqual(ngoAuthRes.status, 200);
        const ngoAuthData = await ngoAuthRes.json();
        assert.strictEqual(ngoAuthData.user.id, ngoUser.id);
        assert.strictEqual(ngoAuthData.user.role, 'ngo');
        console.log('✅ TEST 7 PASSED: NGO role and permissions preserved across refresh.');
        passed++;

        // -----------------------------------------------------------------
        // TEST 8: Serverless Cryptographic Signature Verification
        // -----------------------------------------------------------------
        console.log('--- TEST 8: Serverless Session Persistence Across Containers ---');
        // Simulate cold-start where SQLite sessions table does not have the token
        const { DatabaseSync } = require('node:sqlite');
        const dbPath = path.join(__dirname, '..', 'foodshare.db');
        const testDb = new DatabaseSync(dbPath);
        // Temporarily delete token from sessions table (simulating fresh /tmp container on Vercel)
        testDb.prepare('DELETE FROM sessions WHERE token = ?;').run(donor1Token);

        // Fetching /auth/me should STILL succeed via cryptographic token verification!
        const serverlessAuthRes = await fetch(`${baseUrl}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${donor1Token}` }
        });
        assert.strictEqual(serverlessAuthRes.status, 200, 'Serverless token verification must succeed even if session table was cold started');
        const serverlessAuthData = await serverlessAuthRes.json();
        assert.strictEqual(serverlessAuthData.user.id, donor1.id);
        console.log('✅ TEST 8 PASSED: Serverless token verification succeeds across container cold starts.');
        passed++;

        // -----------------------------------------------------------------
        // TEST 9: Invalid & Tampered Tokens Strictly Rejected (HTTP 401)
        // -----------------------------------------------------------------
        console.log('--- TEST 9: Invalid Tokens Strictly Rejected ---');
        const badTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
            headers: { 'Authorization': 'Bearer sb_invalidPayload_fakeHmac12345' }
        });
        assert.strictEqual(badTokenRes.status, 401);

        const noTokenRes = await fetch(`${baseUrl}/api/auth/me`);
        assert.strictEqual(noTokenRes.status, 401);
        console.log('✅ TEST 9 PASSED: Tampered and missing tokens strictly rejected with 401.');
        passed++;

        // -----------------------------------------------------------------
        // TEST 10: Explicit Logout Revocation (POST /api/auth/logout)
        // -----------------------------------------------------------------
        console.log('--- TEST 10: Explicit Logout Revocation ---');
        const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${donor1Token}` }
        });
        assert.strictEqual(logoutRes.status, 200);

        // After logout, token must be rejected even if HMAC is valid
        const postLogoutRes = await fetch(`${baseUrl}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${donor1Token}` }
        });
        assert.strictEqual(postLogoutRes.status, 401, 'Logged out token must be rejected');
        console.log('✅ TEST 10 PASSED: Explicit logout immediately revokes session.');
        passed++;

        // -----------------------------------------------------------------
        // TEST 11: Public Statistics Endpoint Does Not Require Auth
        // -----------------------------------------------------------------
        console.log('--- TEST 11: Public Stats Security ---');
        const publicStats = await (await fetch(`${baseUrl}/api/stats`)).json();
        assert(typeof publicStats.totalFood === 'number');
        assert(typeof publicStats.totalMeals === 'number');
        assert(typeof publicStats.totalDonations === 'number');
        assert.strictEqual(publicStats.donorEmail, undefined, 'Private donor information must not be exposed in stats');
        console.log('✅ TEST 11 PASSED: Public statistics endpoint is open to visitors without exposing private data.');
        passed++;

    } finally {
        // Teardown: Clean up test records
        const { DatabaseSync } = require('node:sqlite');
        const dbPath = path.join(__dirname, '..', 'foodshare.db');
        const testDb = new DatabaseSync(dbPath);

        for (const id of testDonationIds) {
            try { testDb.prepare('DELETE FROM donations WHERE id = ?;').run(id); } catch {}
        }
        for (const uid of testUserIds) {
            try { testDb.prepare('DELETE FROM sessions WHERE user_id = ?;').run(uid); } catch {}
            try { testDb.prepare('DELETE FROM users WHERE id = ?;').run(uid); } catch {}
            try { testDb.prepare('DELETE FROM notifications WHERE user_email LIKE ?;').run(`%${uid}%`); } catch {}
        }
    }

    console.log('\n====================================================');
    console.log(`  🎉 Test Suite Completed: ${passed}/${total} Passed!`);
    console.log('====================================================\n');
}

runTests().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});
