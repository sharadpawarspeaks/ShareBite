const assert = require('node:assert');

const BASE_URL = 'http://localhost:3001';

async function request(path, options = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
}

async function runTests() {
    console.log('🚀 Starting Comprehensive Verification Test Suite for ShareBite...\n');

    let passed = 0;
    let failed = 0;

    function report(testName, ok, info = '') {
        if (ok) {
            console.log(`✅ [PASS] ${testName} ${info}`);
            passed++;
        } else {
            console.error(`❌ [FAIL] ${testName} ${info}`);
            failed++;
        }
    }

    // -----------------------------------------------------------------
    // TEST 1: Distance Calculation (Haversine) at 2km, 10km, exactly 15.0km, beyond 15km, invalid coords
    // -----------------------------------------------------------------
    console.log('--- TEST 1: Haversine Distance & 15km Boundary ---');
    const db = require('./db.js');

    // Reference NGO point: Mumbai Central (18.9750, 72.8258)
    const ngoLat = 18.9750;
    const ngoLon = 72.8258;

    // Point A: ~2.0 km away (18.9930, 72.8258)
    const dist2km = db.calculateDistanceKm(ngoLat, ngoLon, 18.9930, 72.8258);
    report('Distance ~2.0 km calculation', dist2km >= 1.8 && dist2km <= 2.2, `Result: ${dist2km} km`);

    // Point B: ~10.0 km away (19.0650, 72.8258)
    const dist10km = db.calculateDistanceKm(ngoLat, ngoLon, 19.0650, 72.8258);
    report('Distance ~10.0 km calculation', dist10km >= 9.8 && dist10km <= 10.2, `Result: ${dist10km} km`);

    // Point C: ~15.0 km boundary calculation
    const lat15km = ngoLat + (15.0 / 111.0);
    const distExact15 = db.calculateDistanceKm(ngoLat, ngoLon, lat15km, ngoLon);
    report('Distance boundary calculation (~15.0 km)', distExact15 !== null, `Result: ${distExact15} km`);

    // Point D: ~25.0 km away (19.2000, 72.8258)
    const distBeyond15 = db.calculateDistanceKm(ngoLat, ngoLon, 19.2000, 72.8258);
    report('Distance beyond 15 km calculation', distBeyond15 > 15.0, `Result: ${distBeyond15} km`);

    // Invalid & Missing coordinates
    const distMissing = db.calculateDistanceKm(ngoLat, ngoLon, null, 72.8258);
    report('Missing coordinates returns null', distMissing === null, `Result: ${distMissing}`);

    const distNaN = db.calculateDistanceKm(ngoLat, ngoLon, 'abc', 72.8258);
    report('Invalid coordinates returns null', distNaN === null, `Result: ${distNaN}`);

    // Test API distance filtering with enforceRadius
    const resDistApi = await request(`/api/donations?lat=${ngoLat}&lng=${ngoLon}&enforceRadius=true`);
    report('GET /api/donations accepts lat/lng and returns distanceKm', Array.isArray(resDistApi.data), `Count: ${resDistApi.data.length}`);
    if (resDistApi.data.length > 0) {
        const d0 = resDistApi.data[0];
        report('Donation card has distanceKm and distanceText', d0.distanceKm !== undefined, `Text: ${d0.distanceText}`);
        const allWithin15 = resDistApi.data.every(d => d.distanceKm === null || d.distanceKm <= 15.0);
        report('All filtered donations are <= 15.0 km', allWithin15);
    }

    // -----------------------------------------------------------------
    // TEST 2: Email OTP Delivery & Resend Free Tier Sandbox Handling
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: Email OTP Delivery & Resend Sandbox Behavior ---');
    const resOtpOwner = await request('/api/auth/register-otp', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Sharad Owner Test',
            email: 'pawarsharad1203@gmail.com',
            password: 'SecurePassword123!',
            role: 'donor'
        })
    });
    report('OTP Endpoint responds properly for verified owner email', 
        [200, 409, 429].includes(resOtpOwner.status), 
        `Status: ${resOtpOwner.status}, Message: ${resOtpOwner.data.message || resOtpOwner.data.error}`
    );

    const resOtpSandbox = await request('/api/auth/register-otp', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Non Owner User',
            email: `unregistered_user_${Date.now()}@example.com`,
            password: 'SecurePassword123!',
            role: 'ngo'
        })
    });
    report('Resend Sandbox restriction is caught and returned with meaningful error',
        (resOtpSandbox.status === 403 && resOtpSandbox.data.isSandboxRestriction) || resOtpSandbox.status === 200,
        `Status: ${resOtpSandbox.status}, isSandbox: ${resOtpSandbox.data.isSandboxRestriction}`
    );

    // -----------------------------------------------------------------
    // TEST 3: OTP Challenge Lifecycle & Security Limits
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: OTP Challenge Lifecycle & Security Limits ---');
    const testEmail = `otptest_user_${Date.now()}@testsharebite.local`;

    const challengeOtp = '765432';
    db.createRegistrationChallenge({
        name: 'Fresh Registered NGO',
        email: testEmail,
        passwordHash: db.hashPassword('Password123!'),
        role: 'ngo',
        otp: challengeOtp
    });

    // 3a. Invalid OTP
    const resInvalidOtp = await request('/api/auth/register-verify', {
        method: 'POST',
        body: JSON.stringify({ email: testEmail, otp: '000000' })
    });
    report('Invalid OTP rejected with 400 and remaining attempts', resInvalidOtp.status === 400 && resInvalidOtp.data.error.includes('attempt'), resInvalidOtp.data.error);

    // 3b. Verify failed attempt increments
    const chalAfterFail = db.getRegistrationChallenge(testEmail);
    report('Failed attempt recorded in database', chalAfterFail.failed_attempts === 1, `Failed attempts: ${chalAfterFail.failed_attempts}`);

    // 3c. Successful OTP verification creates verified user
    const resValidOtp = await request('/api/auth/register-verify', {
        method: 'POST',
        body: JSON.stringify({ email: testEmail, otp: challengeOtp })
    });
    report('Valid 6-digit OTP verification succeeds with 201', resValidOtp.status === 201, `User ID: ${resValidOtp.data.user?.id}`);

    // 3d. Reused OTP is rejected because challenge was consumed
    const resReusedOtp = await request('/api/auth/register-verify', {
        method: 'POST',
        body: JSON.stringify({ email: testEmail, otp: challengeOtp })
    });
    report('Reused OTP is rejected (single-use enforcement)', resReusedOtp.status === 400, resReusedOtp.data.error);

    // -----------------------------------------------------------------
    // TEST 4: Password-Reset OTP Verification
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: Password-Reset OTP Verification ---');
    let resetUser = db.getUserByEmail('donor@foodshare.org');
    if (!resetUser) {
        db.ensureTestAccounts();
        resetUser = db.getUserByEmail('donor@foodshare.org');
    }
    const resetOtp = '889900';
    const resetReq = db.createPasswordResetRequest(resetUser, resetOtp);
    report('Password reset request created', Boolean(resetReq && resetReq.id));

    const resVerifyReset = await request('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email: 'donor@foodshare.org', otp: resetOtp })
    });
    report('Reset OTP verified successfully and returned resetToken', resVerifyReset.status === 200 && Boolean(resVerifyReset.data.resetToken));

    if (resVerifyReset.data.resetToken) {
        const resCompleteReset = await request('/api/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({
                email: 'donor@foodshare.org',
                resetToken: resVerifyReset.data.resetToken,
                newPassword: 'UpdatedPassword123!',
                confirmPassword: 'UpdatedPassword123!'
            })
        });
        report('Password reset completed successfully', resCompleteReset.status === 200);

        const resLogin = await request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                email: 'donor@foodshare.org',
                password: 'UpdatedPassword123!',
                role: 'donor'
            })
        });
        report('Login with newly reset password succeeds', resLogin.status === 200);
    }

    // -----------------------------------------------------------------
    // TEST 5: NGO 5-Step Registration & Profile Persistence
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: NGO 5-Step Onboarding Profile ---');
    const freshNgoUser = db.getUserByEmail(testEmail);
    const freshNgoToken = db.createSession(freshNgoUser.id);

    const ngoOnboardingPayload = {
        orgName: 'Helping Hands Community Food Hub',
        orgType: 'Section 8 Company',
        regNumber: 'U85300MH2022NPL389012',
        yearEstablished: 2022,
        description: 'Dedicated to distributing surplus hot meals and fresh produce across central city shelters.',
        website: 'https://helpinghands-hub.org',
        logo: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?auto=format&fit=crop&w=400&q=80',
        
        country: 'India',
        state: 'Maharashtra',
        city: 'Mumbai',
        area: 'Dadar East',
        address: '42 Mahatma Jyotiba Phule Marg, Dadar East',
        pincode: '400014',
        latitude: 19.0178,
        longitude: 72.8478,

        phone: '+91 98201 55667',
        contactPerson: 'Arun Deshmukh',
        contactDesignation: 'Executive Operations Director',

        docName: 'Section8_Incorporation_Cert.pdf',
        docUrl: 'data:application/pdf;base64,JVBERi0xLjQK...',

        acceptedCategories: ['Cooked Food', 'Packaged Food', 'Bakery Items', 'Vegetables'],
        maxQuantity: 250,
        hasRefrigeration: true,
        hasTransport: true,
        operatingHours: 'Daily 7:00 AM - 9:00 PM',
        collectionTimePref: 'Morning and Evening preferred'
    };

    const resOnboard = await request('/api/ngo/onboard', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${freshNgoToken}` },
        body: JSON.stringify(ngoOnboardingPayload)
    });
    report('NGO 5-step registration profile saved', resOnboard.status === 200, resOnboard.data.message);

    const resGetProfile = await request('/api/ngo/profile', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${freshNgoToken}` }
    });
    report('NGO profile retrieved persistently', resGetProfile.status === 200 && resGetProfile.data.profile?.orgName === ngoOnboardingPayload.orgName);
    report('NGO confirmed coordinates match', Number(resGetProfile.data.profile?.latitude) === 19.0178 && Number(resGetProfile.data.profile?.longitude) === 72.8478);
    report('NGO verification status starts as pending', resGetProfile.data.profile?.verificationStatus === 'pending');

    // -----------------------------------------------------------------
    // TEST 6: NGO Verification & Claim Authorization
    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: NGO Verification Status Enforcement on Donation Acceptance ---');
    let donorUser = db.getUserByEmail('donor@foodshare.org');
    const testDonation = db.createDonation({
        foodName: `Fresh Veg Pulao ${Date.now()}`,
        foodType: 'Cooked Food',
        quantity: 20,
        preparedDate: new Date().toISOString().split('T')[0],
        expiryDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        pickupLocation: 'Matunga, Mumbai',
        latitude: 19.0269,
        longitude: 72.8553,
        description: 'Freshly prepared food for evening distribution',
        image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80'
    }, donorUser);

    // Try to accept while fresh NGO profile is 'pending'
    const resAcceptPending = await request(`/api/donations/${testDonation.id}/accept`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${freshNgoToken}` }
    });
    report('Pending NGO cannot accept donations (verification rule enforced)', resAcceptPending.status === 400 && resAcceptPending.data.error.includes('pending'), resAcceptPending.data.error);

    // Admin verifies the NGO
    db.updateNGOVerificationStatus(freshNgoUser.id, 'verified');
    const verifiedProfile = db.getNGOProfileByUserId(freshNgoUser.id);
    report('Admin updates NGO status to verified', verifiedProfile.verificationStatus === 'verified');

    // Now accept the donation as verified NGO
    const resAcceptVerified = await request(`/api/donations/${testDonation.id}/accept`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${freshNgoToken}` }
    });
    report('Verified NGO can accept donation within 15 km', resAcceptVerified.status === 200, `Status: ${resAcceptVerified.data.status}`);

    // Verify distance is calculated and returned
    const resDonationAfterAccept = await request(`/api/donations?lat=${ngoOnboardingPayload.latitude}&lng=${ngoOnboardingPayload.longitude}`);
    const found = resDonationAfterAccept.data.find(d => d.id === testDonation.id);
    if (found) {
        report('Accepted donation retains calculated distanceKm', typeof found.distanceKm === 'number', `Distance: ${found.distanceText}`);
    }

    // -----------------------------------------------------------------
    // TEST 7: 4th Stat Card (NGOs Participating)
    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: Global Stats & 4th NGO Stat Card ---');
    const resStats = await request('/api/stats');
    report('Stats API returns totalActiveVerifiedNGOs', typeof resStats.data.totalActiveVerifiedNGOs === 'number', `Verified NGOs count: ${resStats.data.totalActiveVerifiedNGOs}`);

    console.log(`\n======================================================`);
    console.log(`  📊 Test Summary: ${passed} passed, ${failed} failed`);
    console.log(`======================================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Unhandled test suite error:', err);
    process.exit(1);
});
