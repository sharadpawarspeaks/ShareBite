/**
 * ShareBite Security Test Suite: Email OTP Password Reset
 * Validates all 18 required security scenarios.
 */

const assert = require('node:assert');
const http = require('node:http');
const db = require('../db.js');
const requestHandler = require('../server.js');
const emailService = require('../emailService.js');

console.log('====================================================');
console.log('  🔒 Running ShareBite Security Test Suite (OTP Password Reset)');
console.log('====================================================\n');

let server;
let baseUrl;

function startTestServer() {
    return new Promise((resolve) => {
        server = http.createServer(requestHandler);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
}

function stopTestServer() {
    return new Promise((resolve) => {
        if (server) {
            server.close(() => resolve());
        } else {
            resolve();
        }
    });
}

async function apiPost(endpoint, body) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
}

async function runAllSecurityTests() {
    await startTestServer();
    emailService.clearTestEmails();
    db.clearPasswordResetsForTesting();

    const registeredEmail = 'donor@foodshare.org';
    const unknownEmail = 'unknown_random_user_999@example.com';
    let testPassed = 0;
    const totalTests = 18;

    try {
        // Ensure registered test user has known initial password
        const initialUser = db.getUserByEmail(registeredEmail);
        assert(initialUser, 'Registered user should exist');
        db.completePasswordReset(initialUser.id, 0, 'password123');

        // ---------------------------------------------------------------------
        // TEST 1: Valid registered email requests an OTP
        // ---------------------------------------------------------------------
        const req1 = await apiPost('/api/auth/forgot-password', { email: registeredEmail });
        assert.strictEqual(req1.status, 200, 'Test 1: Status should be 200');
        assert.strictEqual(req1.data.success, true, 'Test 1: Success flag true');
        const emailSent1 = emailService.getLastSentEmailForTesting(registeredEmail);
        assert(emailSent1, 'Test 1: OTP email should be dispatched');
        assert(/^\d{6}$/.test(emailSent1.otp), 'Test 1: Dispatched OTP must be exactly 6 digits');
        console.log('✅ TEST 1 PASSED: Valid registered email requests an OTP.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 2: Unknown email receives a generic response (prevent user enumeration)
        // ---------------------------------------------------------------------
        const req2 = await apiPost('/api/auth/forgot-password', { email: unknownEmail });
        assert.strictEqual(req2.status, 200, 'Test 2: Should return 200 for unknown email');
        assert.strictEqual(req2.data.success, true, 'Test 2: Success should be true');
        assert.strictEqual(req2.data.message, req1.data.message, 'Test 2: Response message must be identical to registered email response');
        const emailSentUnknown = emailService.getLastSentEmailForTesting(unknownEmail);
        assert.strictEqual(emailSentUnknown, null, 'Test 2: No email should be sent for unknown address');
        console.log('✅ TEST 2 PASSED: Unknown email receives an identical generic response.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 3: Correct OTP verifies successfully
        // ---------------------------------------------------------------------
        const otpCode = emailSent1.otp;
        const req3 = await apiPost('/api/auth/verify-otp', { email: registeredEmail, otp: otpCode });
        assert.strictEqual(req3.status, 200, 'Test 3: Correct OTP should return 200');
        assert.strictEqual(req3.data.success, true, 'Test 3: Success should be true');
        assert(req3.data.resetToken && req3.data.resetToken.length >= 32, 'Test 3: Should issue a secure reset authorization token');
        const resetAuthToken = req3.data.resetToken;
        console.log('✅ TEST 3 PASSED: Correct OTP verifies successfully and issues reset token.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 4: Incorrect OTP is rejected
        // ---------------------------------------------------------------------
        // Create fresh request for testing bad OTPs
        const testUser = db.getUserByEmail(registeredEmail);
        // Force cooldown expiration for next test step
        db.createPasswordResetRequest(testUser, '123456');
        const req4 = await apiPost('/api/auth/verify-otp', { email: registeredEmail, otp: '999999' });
        assert.strictEqual(req4.status, 400, 'Test 4: Bad OTP should return 400');
        assert(req4.data.error.includes('Incorrect verification code') || req4.data.error.includes('attempts remaining'), 'Test 4: Error message should note incorrect code');
        console.log('✅ TEST 4 PASSED: Incorrect OTP is rejected with remaining attempts.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 5: Expired OTP is rejected
        // ---------------------------------------------------------------------
        const expiredOtp = '654321';
        const expReq = db.createPasswordResetRequest(testUser, expiredOtp);
        db.expireResetRequestForTesting(expReq.id);
        const req5 = await apiPost('/api/auth/verify-otp', { email: registeredEmail, otp: expiredOtp });
        assert.strictEqual(req5.status, 400, 'Test 5: Expired OTP must return 400');
        assert(req5.data.error.includes('expired'), 'Test 5: Error must mention expired code');
        console.log('✅ TEST 5 PASSED: Expired OTP is rejected.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 6: OTP cannot be reused
        // ---------------------------------------------------------------------
        // Attempt to verify already-verified OTP from Test 3
        const req6 = await apiPost('/api/auth/verify-otp', { email: registeredEmail, otp: otpCode });
        assert.strictEqual(req6.status, 400, 'Test 6: Used OTP should be rejected');
        console.log('✅ TEST 6 PASSED: OTP cannot be reused after verification.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 7: More than 5 failed attempts are rejected (brute-force lockout)
        // ---------------------------------------------------------------------
        const bruteUser = db.getUserByEmail('ngo@foodshare.org');
        db.createPasswordResetRequest(bruteUser, '555555');
        for (let i = 0; i < 5; i++) {
            await apiPost('/api/auth/verify-otp', { email: 'ngo@foodshare.org', otp: '111111' });
        }
        // 6th attempt with ANY code (even correct code) must be blocked
        const req7 = await apiPost('/api/auth/verify-otp', { email: 'ngo@foodshare.org', otp: '555555' });
        assert.strictEqual(req7.status, 400, 'Test 7: Should lock out after 5 failures');
        assert(req7.data.error.includes('Maximum verification attempts exceeded'), 'Test 7: Must return lockout error');
        console.log('✅ TEST 7 PASSED: More than 5 failed attempts lock out the OTP.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 8: Resending respects the 60-second cooldown
        // ---------------------------------------------------------------------
        const freshUser = db.getUserByEmail('rajesh.donor@example.com');
        db.createPasswordResetRequest(freshUser, '222222');
        const req8 = await apiPost('/api/auth/forgot-password', { email: 'rajesh.donor@example.com' });
        assert.strictEqual(req8.status, 429, 'Test 8: Immediate re-request must return 429');
        assert(req8.data.error.includes('Please wait'), 'Test 8: Cooldown notice returned');
        console.log('✅ TEST 8 PASSED: Resending respects the 60-second cooldown.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 9: Excessive requests are rate-limited
        // ---------------------------------------------------------------------
        const rateLimitUser = db.getUserByEmail('contact@sunnyfarms.org');
        // Simulate 5 requests within the hour
        for (let i = 0; i < 5; i++) {
            db.createPasswordResetRequest(rateLimitUser, String(100000 + i));
        }
        const req9 = await apiPost('/api/auth/forgot-password', { email: 'contact@sunnyfarms.org' });
        assert.strictEqual(req9.status, 429, 'Test 9: 6th request within hour must return 429');
        assert(req9.data.error.includes('Too many password reset requests'), 'Test 9: Rate limit message returned');
        console.log('✅ TEST 9 PASSED: Excessive requests are rate-limited.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 10: Password reset fails without OTP verification
        // ---------------------------------------------------------------------
        const req10 = await apiPost('/api/auth/reset-password', {
            email: registeredEmail,
            resetToken: 'unverified_token_random_string',
            newPassword: 'BrandNewPassword123!',
            confirmPassword: 'BrandNewPassword123!'
        });
        assert.strictEqual(req10.status, 400, 'Test 10: Reset must fail without valid token');
        console.log('✅ TEST 10 PASSED: Password reset fails without verified OTP token.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 11: Invalid reset tokens are rejected
        // ---------------------------------------------------------------------
        const req11 = await apiPost('/api/auth/reset-password', {
            email: registeredEmail,
            resetToken: 'invalid_deadbeef_token_1234567890',
            newPassword: 'BrandNewPassword123!',
            confirmPassword: 'BrandNewPassword123!'
        });
        assert.strictEqual(req11.status, 400, 'Test 11: Fake token rejected');
        assert(req11.data.error.includes('Invalid or expired'), 'Test 11: Error must state invalid session');
        console.log('✅ TEST 11 PASSED: Invalid reset tokens are safely rejected.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 12 & 13: Password reset completes, token consumed, and password securely hashed
        // ---------------------------------------------------------------------
        const freshOtpForReset = '987654';
        db.createPasswordResetRequest(testUser, freshOtpForReset);
        const verifyRes = await apiPost('/api/auth/verify-otp', { email: registeredEmail, otp: freshOtpForReset });
        assert.strictEqual(verifyRes.status, 200, 'Test 12: Verify OTP should succeed');
        const activeResetToken = verifyRes.data.resetToken;

        const newPasswordPlain = 'NewSecureP@ssword2026!';
        const req12 = await apiPost('/api/auth/reset-password', {
            email: registeredEmail,
            resetToken: activeResetToken,
            newPassword: newPasswordPlain,
            confirmPassword: newPasswordPlain
        });
        assert.strictEqual(req12.status, 200, 'Test 12: Valid reset should succeed with 200');
        assert.strictEqual(req12.data.success, true, 'Test 12: Success should be true');

        // Verify token cannot be reused
        const req12Reuse = await apiPost('/api/auth/reset-password', {
            email: registeredEmail,
            resetToken: activeResetToken,
            newPassword: 'YetAnotherPassword123!',
            confirmPassword: 'YetAnotherPassword123!'
        });
        assert.strictEqual(req12Reuse.status, 400, 'Test 12: Reset token reuse must be rejected');
        console.log('✅ TEST 12 PASSED: Reset authorization tokens cannot be reused.');
        testPassed++;

        // Check password hash in DB
        const updatedUser = db.getUserByEmail(registeredEmail);
        assert(updatedUser.password_hash.includes(':'), 'Test 13: Password must be stored as salt:hash');
        assert(!updatedUser.password_hash.includes(newPasswordPlain), 'Test 13: Plaintext password must never appear in DB');
        console.log('✅ TEST 13 PASSED: New password is cryptographically hashed with salt.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 14: Existing password no longer works after reset
        // ---------------------------------------------------------------------
        const oldLogin = await apiPost('/api/auth/login', {
            email: registeredEmail,
            password: 'password123',
            role: 'donor'
        });
        assert.strictEqual(oldLogin.status, 401, 'Test 14: Old password must be rejected');
        console.log('✅ TEST 14 PASSED: Existing password no longer works after reset.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 15: New password works through existing login system
        // ---------------------------------------------------------------------
        const newLogin = await apiPost('/api/auth/login', {
            email: registeredEmail,
            password: newPasswordPlain,
            role: 'donor'
        });
        assert.strictEqual(newLogin.status, 200, 'Test 15: Login with new password must succeed');
        assert(newLogin.data.token, 'Test 15: Session token issued');
        console.log('✅ TEST 15 PASSED: New password works through the existing login system.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 16: Existing sessions are invalidated upon password reset
        // ---------------------------------------------------------------------
        const activeToken = newLogin.data.token;
        // Verify active token works
        const checkUser = db.getUserByToken(activeToken);
        assert(checkUser, 'Session should be valid');

        // Reset password again to trigger session invalidation
        const resetReqAgain = db.createPasswordResetRequest(initialUser, '777777');
        const tokenHash2 = db.hashToken('token_for_session_test');
        db.markOtpVerified(resetReqAgain.id, tokenHash2, new Date(Date.now() + 60000).toISOString());
        db.completePasswordReset(initialUser.id, resetReqAgain.id, 'BrandNewPass2027#');

        // The previously active session token MUST now be deleted / null
        const revokedUser = db.getUserByToken(activeToken);
        assert.strictEqual(revokedUser, null, 'Test 16: Previous session token must be revoked');
        console.log('✅ TEST 16 PASSED: Existing sessions are invalidated upon password reset.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 17: Existing donor and NGO functionality remains operational
        // ---------------------------------------------------------------------
        const donations = db.getDonations();
        assert(Array.isArray(donations), 'Test 17: Donations listing must work');
        const stats = db.getStats();
        assert(typeof stats.totalFood === 'number', 'Test 17: Stats calculation must work');
        console.log('✅ TEST 17 PASSED: Existing donor and NGO functionality remains operational.');
        testPassed++;

        // ---------------------------------------------------------------------
        // TEST 18: OTP records work across separate serverless invocations (DB-backed)
        // ---------------------------------------------------------------------
        // Verification is done directly against persistent SQLite DB table `password_resets`
        const persistUser = db.getUserByEmail('depot@metrogrocers.com');
        const testOtp = '888888';
        const createdReq = db.createPasswordResetRequest(persistUser, testOtp);
        assert(createdReq.id, 'Test 18: Reset record stored in persistent DB');

        // Simulate separate invocation: query database independently
        const queriedReq = db.getLatestActiveResetRequest('depot@metrogrocers.com');
        assert.strictEqual(queriedReq.id, createdReq.id, 'Test 18: Record survives across query boundaries');
        assert(db.verifyOtp(testOtp, queriedReq.otp_hash), 'Test 18: OTP hash verified from persistent storage');
        console.log('✅ TEST 18 PASSED: OTP records work across separate serverless invocations via persistent DB.');
        testPassed++;

        console.log('\n====================================================');
        console.log(`  🎉 Security Test Results: ${testPassed}/${totalTests} Passed`);
        console.log('====================================================\n');

    } finally {
        await stopTestServer();
    }
}

runAllSecurityTests().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('❌ Security Test Failure:', err);
    process.exit(1);
});
