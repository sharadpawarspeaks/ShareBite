try {
    require('dotenv').config();
} catch {}

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Automatically load .env configuration if present
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        for (const line of envContent.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const [k, ...v] = trimmed.split('=');
                const key = k.trim();
                const val = v.join('=').trim().replace(/^["']|["']$/g, '');
                if (key) {
                    process.env[key] = val;
                }
            }
        }
    }
} catch (envErr) {
    console.warn('Could not read .env file:', envErr.message);
}

const db = require('./db.js');
const dateUtils = require('./dateUtils.js');
const crypto = require('node:crypto');
const emailService = require('./emailService.js');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
};

const DEFAULT_CATEGORY_IMAGES = {
    'Cooked Food': 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80',
    'Packaged Food': 'https://images.unsplash.com/photo-1588964895597-cfccd6e2dbf9?auto=format&fit=crop&w=800&q=80',
    'Fruits': 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=800&q=80',
    'Vegetables': 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80',
    'Bakery Items': 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80',
    'Dairy Products': 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=800&q=80'
};

// -------------------------------------------------------------
// Request Helpers
// -------------------------------------------------------------
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 10 * 1024 * 1024) { // 10MB limit
                reject(new Error('Payload too large'));
            }
        });
        req.on('end', () => {
            if (!body.trim()) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error('Invalid JSON format'));
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
    sendJson(res, statusCode, { error: message });
}

function getAuthUser(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        const token = parts[1];
        return db.getUserByToken(token);
    }
    return null;
}

function reloadEnvConfig() {
    try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            for (const line of envContent.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const [k, ...v] = trimmed.split('=');
                    const key = k.trim();
                    const val = v.join('=').trim().replace(/^["']|["']$/g, '');
                    if (key) {
                        process.env[key] = val;
                    }
                }
            }
        }
    } catch {
        // Ignore read errors
    }
}

function getGeminiApiKey() {
    reloadEnvConfig();
    const key = process.env.GEMINI_API_KEY || db.getSetting('gemini_api_key');
    return (key && key.trim()) ? key.trim() : null;
}

function getGroqApiKey() {
    reloadEnvConfig();
    const key = process.env.GROQ_API_KEY || db.getSetting('groq_api_key');
    return (key && key.trim()) ? key.trim() : null;
}

function getGoogleMapsApiKey() {
    reloadEnvConfig();
    const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAP_API_KEY || db.getSetting('google_maps_api_key');
    return (key && key.trim()) ? key.trim() : null;
}

function getMapTilerApiKey() {
    reloadEnvConfig();
    const key = process.env.MAPTILER_API_KEY || db.getSetting('maptiler_api_key');
    return (key && key.trim()) ? key.trim() : null;
}

// -------------------------------------------------------------
// AI-Assisted Food Prioritisation (TEXT ONLY - NO IMAGES)
// -------------------------------------------------------------
async function callGeminiApi(promptText, geminiKey) {
    const models = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash'];
    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{
                            text: "You are ShareBite's AI Food Redistribution Assistant. Your role is solely to provide a concise 1-sentence priority explanation and food-safety handling recommendation for NGOs based ONLY on stated text details. The backend priority is fixed and authoritative. Never contradict the priority. Never invent dates. Never ask for images."
                        }]
                    },
                    contents: [{
                        parts: [{
                            text: promptText
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 100
                    }
                })
            });

            if (response.ok) {
                const data = await response.json();
                const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                if (aiText) {
                    return { text: aiText, model };
                }
            }
        } catch {
            // Try next model if any network or model availability issue
        }
    }
    return null;
}

async function callGroqApi(promptText, groqKey) {
    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqKey}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'system',
                        content: 'You are ShareBite\'s AI Food Redistribution Assistant. Your role is solely to provide a concise 1-sentence priority explanation and food-safety handling recommendation for NGOs based ONLY on stated text details. The backend priority is fixed and authoritative. Never contradict the priority. Never invent dates. Never ask for images.'
                    },
                    {
                        role: 'user',
                        content: promptText
                    }
                ],
                temperature: 0.2,
                max_tokens: 100
            })
        });

        if (response.ok) {
            const data = await response.json();
            return data.choices?.[0]?.message?.content?.trim() || null;
        }
    } catch {
        return null;
    }
    return null;
}

async function generateAIPriorityExplanation({ foodName, foodType, quantity, expiryDate, preparedDate }) {
    // 1. Backend deterministic calculation is the single authoritative source of truth
    const priorityCalc = dateUtils.calculateFoodPriority(expiryDate);
    const priority = priorityCalc.priority;
    const priorityLevel = priorityCalc.priorityLevel || (priority === 'LOW' ? 'NORMAL' : priority);
    const daysRemaining = priorityCalc.daysRemaining;

    // 2. Standard deterministic explanation (fallback / offline)
    let defaultReason = `Food expires on ${dateUtils.formatDateToDisplay(expiryDate)}.`;
    if (priorityCalc.isExpired) {
        defaultReason = `Expired: Food has passed its expiration date and is not eligible for distribution.`;
    } else if (priorityCalc.expiresToday) {
        defaultReason = `Urgent: Food expires today! Rapid redistribution required to ensure food safety.`;
    } else if (daysRemaining <= 2) {
        defaultReason = `High urgency: Food expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Immediate collection recommended.`;
    } else if (daysRemaining <= 5) {
        defaultReason = `Moderate urgency: Food expires in ${daysRemaining} days. Standard NGO pickup window.`;
    } else if (priorityCalc.valid) {
        defaultReason = `Standard window: Food expires in ${daysRemaining} days. Safe collection window available.`;
    } else {
        defaultReason = `Verification needed: Missing or invalid expiry information. Please confirm with donor before collection.`;
    }

    const promptText = `Food: "${foodName || 'Donation'}", Category: "${foodType || 'General'}", Quantity: ${quantity || 1} kg, Expiry Date: "${expiryDate}", Calculated Priority: "${priorityLevel}" (${daysRemaining !== null ? daysRemaining + ' days remaining' : 'unspecified'}). Provide a 1-sentence explanation for NGOs.`;

    // 3. Try Google Gemini AI first (preferred)
    const geminiKey = getGeminiApiKey();
    if (geminiKey) {
        const geminiRes = await callGeminiApi(promptText, geminiKey);
        if (geminiRes && geminiRes.text) {
            return {
                priority,
                priorityLevel,
                daysRemaining,
                badgeLabel: priorityCalc.badgeLabel,
                badgeClass: priorityCalc.badgeClass,
                isExpired: priorityCalc.isExpired,
                expiresToday: priorityCalc.expiresToday,
                explanation: geminiRes.text,
                provider: `Google Gemini AI (${geminiRes.model} Text Prioritisation)`
            };
        }
    }

    // 4. Fallback to Groq AI if configured
    const groqKey = getGroqApiKey();
    if (groqKey) {
        const groqText = await callGroqApi(promptText, groqKey);
        if (groqText) {
            return {
                priority,
                priorityLevel,
                daysRemaining,
                badgeLabel: priorityCalc.badgeLabel,
                badgeClass: priorityCalc.badgeClass,
                isExpired: priorityCalc.isExpired,
                expiresToday: priorityCalc.expiresToday,
                explanation: groqText,
                provider: 'Groq Llama 3 AI (Text Prioritisation)'
            };
        }
    }

    // 5. Deterministic rule engine fallback
    return {
        priority,
        priorityLevel,
        daysRemaining,
        badgeLabel: priorityCalc.badgeLabel,
        badgeClass: priorityCalc.badgeClass,
        isExpired: priorityCalc.isExpired,
        expiresToday: priorityCalc.expiresToday,
        explanation: defaultReason,
        provider: 'Deterministic Food Safety Rule Engine'
    };
}

// -------------------------------------------------------------
// Server Request Handler
// -------------------------------------------------------------
async function requestHandler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
        });
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // ---------------------------------------------------------
    // API ROUTER
    // ---------------------------------------------------------
    if (pathname.startsWith('/api/')) {
        try {
            // GET /api/health
            if (pathname === '/api/health' && method === 'GET') {
                return sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
            }

            // GET /api/stats
            if (pathname === '/api/stats' && method === 'GET') {
                const stats = db.getStats();
                return sendJson(res, 200, stats);
            }

            // POST /api/auth/signup
            if (pathname === '/api/auth/signup' && method === 'POST') {
                const body = await readJsonBody(req);
                const { name, email, password, role } = body;

                if (!name || !email || !password || !role) {
                    return sendError(res, 400, 'Name, email, password and role are required.');
                }
                if (role !== 'donor' && role !== 'ngo') {
                    return sendError(res, 400, 'Role must be either donor or ngo.');
                }

                try {
                    const newUser = db.createUser(name.trim(), email.trim(), password, role);
                    const token = db.createSession(newUser.id);
                    return sendJson(res, 201, { user: newUser, token });
                } catch (err) {
                    return sendError(res, 409, err.message);
                }
            }

            // POST /api/auth/login
            if (pathname === '/api/auth/login' && method === 'POST') {
                const body = await readJsonBody(req);
                const { email, password, role } = body;

                if (!email || !password) {
                    return sendError(res, 400, 'Email and password are required.');
                }

                const user = db.authenticateUser(email.trim(), password, role);
                if (!user) {
                    return sendError(res, 401, 'Invalid email, password, or role credentials.');
                }

                const token = db.createSession(user.id);
                return sendJson(res, 200, { user, token });
            }

            // POST /api/auth/demo
            if (pathname === '/api/auth/demo' && method === 'POST') {
                const body = await readJsonBody(req);
                const role = body.role || 'donor';
                const email = role === 'ngo' ? 'ngo@foodshare.org' : 'donor@foodshare.org';

                let user = db.getUserByEmail(email);
                if (!user) {
                    db.resetDatabase();
                    user = db.getUserByEmail(email);
                }

                const token = db.createSession(user.id);
                return sendJson(res, 200, {
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        role: user.role
                    },
                    token
                });
            }

            // POST /api/auth/social (Google / Apple account sign in)
            if (pathname === '/api/auth/social' && method === 'POST') {
                const body = await readJsonBody(req);
                const { provider, name, email, role } = body;

                if (!email || typeof email !== 'string' || !email.includes('@')) {
                    return sendError(res, 400, 'A valid email address is required.');
                }

                const cleanRole = role === 'ngo' ? 'ngo' : 'donor';
                const cleanName = (name && typeof name === 'string' && name.trim()) ? name.trim() : email.split('@')[0];
                const user = db.findOrCreateOAuthUser(cleanName, email, cleanRole);
                const token = db.createSession(user.id);

                return sendJson(res, 200, {
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        role: user.role
                    },
                    token,
                    provider: provider || 'social'
                });
            }

            // POST /api/auth/logout
            if (pathname === '/api/auth/logout' && method === 'POST') {
                const authHeader = req.headers['authorization'];
                if (authHeader) {
                    const token = authHeader.split(' ')[1];
                    db.deleteSession(token);
                }
                return sendJson(res, 200, { message: 'Logged out successfully' });
            }

            // GET /api/auth/me
            if (pathname === '/api/auth/me' && method === 'GET') {
                const user = getAuthUser(req);
                if (!user) {
                    return sendError(res, 401, 'Unauthorized');
                }
                return sendJson(res, 200, { user });
            }

            // POST /api/auth/forgot-password (Request Password Reset OTP)
            if (pathname === '/api/auth/forgot-password' && method === 'POST') {
                const body = await readJsonBody(req);
                const { email } = body;

                if (!email || typeof email !== 'string' || !email.includes('@')) {
                    return sendError(res, 400, 'Please provide a valid email address.');
                }

                const cleanEmail = email.trim().toLowerCase();

                // 1. Check Hourly Rate Limit (max 5 requests per email per hour)
                const recentRequestsCount = db.getRecentResetRequestsCount(cleanEmail, 1);
                if (recentRequestsCount >= 5) {
                    return sendJson(res, 429, {
                        error: 'Too many password reset requests for this email. Please try again after 1 hour.',
                        retryAfter: 3600
                    });
                }

                // 2. Check Resend Cooldown (60 seconds)
                const activeReq = db.getLatestActiveResetRequest(cleanEmail);
                if (activeReq && activeReq.resend_available_at) {
                    const cooldownRemainingMs = new Date(activeReq.resend_available_at).getTime() - Date.now();
                    if (cooldownRemainingMs > 0) {
                        const remainingSec = Math.ceil(cooldownRemainingMs / 1000);
                        return sendJson(res, 429, {
                            error: `Please wait ${remainingSec}s before requesting another code.`,
                            retryAfter: remainingSec
                        });
                    }
                }

                // 3. User lookup - Always return generic message to prevent account enumeration
                const user = db.getUserByEmail(cleanEmail);
                if (user) {
                    // Generate cryptographically secure random 6-digit OTP
                    const otp = crypto.randomInt(100000, 1000000).toString();

                    // Store hashed OTP in database
                    db.createPasswordResetRequest(user, otp);

                    // Dispatch email
                    try {
                        await emailService.sendPasswordResetEmail({
                            to: user.email,
                            userName: user.name,
                            otp
                        });
                    } catch (emailErr) {
                        console.error('[Auth] Failed to dispatch password reset email:', emailErr.message);
                    }
                }

                // Generic response (security requirement: do not reveal whether user exists)
                return sendJson(res, 200, {
                    success: true,
                    message: 'If that email address is registered, a 6-digit verification code has been sent.',
                    expiresInSeconds: 300,
                    cooldownSeconds: 60
                });
            }

            // POST /api/auth/verify-otp (Verify 6-digit OTP)
            if (pathname === '/api/auth/verify-otp' && method === 'POST') {
                const body = await readJsonBody(req);
                const { email, otp } = body;

                if (!email || !otp) {
                    return sendError(res, 400, 'Email and OTP verification code are required.');
                }

                const cleanEmail = email.trim().toLowerCase();
                const cleanOtp = String(otp).trim();

                if (!/^\d{6}$/.test(cleanOtp)) {
                    return sendError(res, 400, 'Verification code must be exactly 6 digits.');
                }

                const activeReq = db.getLatestActiveResetRequest(cleanEmail);
                if (!activeReq) {
                    return sendError(res, 400, 'No active password reset request found. Please request a new code.');
                }

                // Check if already verified
                if (activeReq.is_verified) {
                    return sendError(res, 400, 'This verification code has already been used.');
                }

                // Check expiration (5 minutes)
                if (new Date(activeReq.otp_expires_at).getTime() < Date.now()) {
                    return sendError(res, 400, 'Verification code has expired. Please request a new code.');
                }

                // Check maximum failed attempts (max 5)
                if (activeReq.failed_attempts >= 5) {
                    return sendError(res, 400, 'Maximum verification attempts exceeded (5/5). Please request a new code.');
                }

                // Verify OTP hash using timing-safe comparison
                const isValid = db.verifyOtp(cleanOtp, activeReq.otp_hash);
                if (!isValid) {
                    const updated = db.recordFailedOtpAttempt(activeReq.id);
                    const remaining = Math.max(0, 5 - updated.failed_attempts);
                    if (remaining <= 0) {
                        return sendError(res, 400, 'Maximum verification attempts exceeded. Please request a new code.');
                    }
                    return sendError(res, 400, `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
                }

                // OTP is valid! Generate single-use reset authorization token (expires in 15 mins)
                const resetToken = crypto.randomBytes(32).toString('hex');
                const resetTokenHash = db.hashToken(resetToken);
                const tokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

                db.markOtpVerified(activeReq.id, resetTokenHash, tokenExpiresAt);

                return sendJson(res, 200, {
                    success: true,
                    message: 'OTP verified successfully.',
                    resetToken
                });
            }

            // POST /api/auth/reset-password (Set new password with authorized token)
            if (pathname === '/api/auth/reset-password' && method === 'POST') {
                const body = await readJsonBody(req);
                const { email, resetToken, newPassword, confirmPassword } = body;

                if (!email || !resetToken || !newPassword || !confirmPassword) {
                    return sendError(res, 400, 'Email, reset token, and password confirmation are required.');
                }

                const cleanEmail = email.trim().toLowerCase();

                if (newPassword !== confirmPassword) {
                    return sendError(res, 400, 'Passwords do not match.');
                }

                if (newPassword.length < 8) {
                    return sendError(res, 400, 'Password must be at least 8 characters long.');
                }

                const resetRecord = db.getValidResetRecordByToken(cleanEmail, resetToken);
                if (!resetRecord) {
                    return sendError(res, 400, 'Invalid or expired password reset authorization. Please start over.');
                }

                if (new Date(resetRecord.reset_token_expires_at).getTime() < Date.now()) {
                    return sendError(res, 400, 'Password reset session has expired (15 minute limit). Please start over.');
                }

                db.completePasswordReset(resetRecord.user_id, resetRecord.id, newPassword);

                return sendJson(res, 200, {
                    success: true,
                    message: 'Your password has been successfully reset! Please sign in with your new password.'
                });
            }

            // GET /api/donations
            if (pathname === '/api/donations' && method === 'GET') {
                const status = parsedUrl.searchParams.get('status');
                const donorEmail = parsedUrl.searchParams.get('donorEmail');
                const acceptedBy = parsedUrl.searchParams.get('acceptedBy');
                const foodType = parsedUrl.searchParams.get('foodType');
                const search = parsedUrl.searchParams.get('search');
                const sort = parsedUrl.searchParams.get('sort');

                const donations = db.getDonations({
                    status,
                    donorEmail,
                    acceptedBy,
                    foodType,
                    search,
                    sort
                });
                return sendJson(res, 200, donations);
            }

            // GET /api/donations/:id
            const donationMatch = pathname.match(/^\/api\/donations\/(\d+)$/);
            if (donationMatch && method === 'GET') {
                const id = Number(donationMatch[1]);
                const donation = db.getDonationById(id);
                if (!donation) {
                    return sendError(res, 404, 'Donation not found');
                }
                return sendJson(res, 200, donation);
            }

            // POST /api/donations (Create donation - Donor)
            if (pathname === '/api/donations' && method === 'POST') {
                const user = getAuthUser(req);
                if (!user) {
                    return sendError(res, 401, 'Please login first.');
                }
                if (user.role !== 'donor') {
                    return sendError(res, 403, 'Only registered donors can submit donations.');
                }

                const body = await readJsonBody(req);
                const { foodName, foodType, quantity, preparedDate, expiryDate, pickupLocation, latitude, longitude, description, image } = body;

                // Strict validation: Food Photo is mandatory and compulsory
                if (!image || typeof image !== 'string' || (!image.startsWith('data:image/') && !image.startsWith('http://') && !image.startsWith('https://'))) {
                    return sendError(res, 400, 'A valid food photo is required. Please upload an image of the food (JPG, JPEG, PNG, or WebP).');
                }

                if (!foodName || !foodName.trim()) {
                    return sendError(res, 400, 'Food name is required.');
                }
                if (!foodType) {
                    return sendError(res, 400, 'Food category is required.');
                }
                const numQuantity = Number(quantity);
                if (!numQuantity || isNaN(numQuantity) || numQuantity <= 0) {
                    return sendError(res, 400, 'Quantity must be a positive number.');
                }
                if (!pickupLocation || !pickupLocation.trim()) {
                    return sendError(res, 400, 'Pickup location is required.');
                }

                // Mandatory Expiry Date validation (DD/MM/YYYY or ISO)
                if (!expiryDate || typeof expiryDate !== 'string') {
                    return sendError(res, 400, 'Expiry date is required.');
                }
                const parsedExpiry = dateUtils.parseDateInput(expiryDate);
                if (!parsedExpiry.valid) {
                    return sendError(res, 400, parsedExpiry.error || 'Invalid expiry date format. Please use DD/MM/YYYY.');
                }

                // Prepared Date validation
                if (!preparedDate || typeof preparedDate !== 'string') {
                    return sendError(res, 400, 'Prepared date is required.');
                }
                const parsedPrepared = dateUtils.parseDateInput(preparedDate);
                if (!parsedPrepared.valid) {
                    return sendError(res, 400, parsedPrepared.error || 'Invalid prepared date format. Please use DD/MM/YYYY.');
                }
                if (parsedExpiry.iso < parsedPrepared.iso) {
                    return sendError(res, 400, 'Expiry date cannot be before prepared date.');
                }

                // Backend independent validation & enforcement for Cooked Food
                let finalPreparedISO = parsedPrepared.iso;
                let finalExpiryISO = parsedExpiry.iso;

                if (foodType === 'Cooked Food') {
                    const expectedCooked = dateUtils.getCookedFoodDates();
                    if (parsedPrepared.iso !== expectedCooked.preparedDateISO || parsedExpiry.iso !== expectedCooked.expiryDateISO) {
                        return sendError(res, 400, `Cooked Food must be prepared today (${expectedCooked.preparedDateDisplay}) and expire tomorrow (${expectedCooked.expiryDateDisplay}).`);
                    }
                    finalPreparedISO = expectedCooked.preparedDateISO;
                    finalExpiryISO = expectedCooked.expiryDateISO;
                }

                try {
                    // Backend calculates priority exclusively from expiry date
                    const donation = db.createDonation({
                        foodName: foodName.trim(),
                        foodType,
                        quantity: numQuantity,
                        preparedDate: finalPreparedISO,
                        expiryDate: finalExpiryISO,
                        pickupLocation: pickupLocation.trim(),
                        latitude: latitude !== undefined && latitude !== null && !isNaN(Number(latitude)) ? Number(latitude) : null,
                        longitude: longitude !== undefined && longitude !== null && !isNaN(Number(longitude)) ? Number(longitude) : null,
                        description: description ? description.trim() : '',
                        image
                    }, user);

                    return sendJson(res, 201, donation);
                } catch (err) {
                    return sendError(res, 400, err.message);
                }
            }

            // POST /api/donations/:id/accept (Accept donation - NGO)
            const acceptMatch = pathname.match(/^\/api\/donations\/(\d+)\/accept$/);
            if (acceptMatch && method === 'POST') {
                const user = getAuthUser(req);
                if (!user) {
                    return sendError(res, 401, 'Please login as an NGO first.');
                }
                if (user.role !== 'ngo') {
                    return sendError(res, 403, 'Only NGOs can accept food donations.');
                }

                const id = Number(acceptMatch[1]);
                try {
                    const updated = db.acceptDonation(id, user);
                    return sendJson(res, 200, updated);
                } catch (err) {
                    return sendError(res, 400, err.message);
                }
            }

            // POST /api/donations/:id/complete (Mark completed - NGO or Donor)
            const completeMatch = pathname.match(/^\/api\/donations\/(\d+)\/complete$/);
            if (completeMatch && method === 'POST') {
                const user = getAuthUser(req);
                if (!user) {
                    return sendError(res, 401, 'Unauthorized');
                }

                const id = Number(completeMatch[1]);
                try {
                    const updated = db.completeDonation(id, user);
                    return sendJson(res, 200, updated);
                } catch (err) {
                    return sendError(res, 400, err.message);
                }
            }

            // DELETE /api/donations/:id (Cancel donation - Donor)
            const deleteMatch = pathname.match(/^\/api\/donations\/(\d+)$/);
            if (deleteMatch && method === 'DELETE') {
                const user = getAuthUser(req);
                if (!user) {
                    return sendError(res, 401, 'Unauthorized');
                }

                const id = Number(deleteMatch[1]);
                try {
                    const result = db.cancelDonation(id, user);
                    return sendJson(res, 200, result);
                } catch (err) {
                    return sendError(res, 400, err.message);
                }
            }

            // POST /api/donations/purge-expired (Trigger automatic deletion of expired food)
            if (pathname === '/api/donations/purge-expired' && method === 'POST') {
                const result = db.purgeExpiredDonations();
                return sendJson(res, 200, {
                    success: true,
                    message: `Purged ${result.deletedCount} expired food listing(s) from database.`,
                    deletedCount: result.deletedCount,
                    deletedIds: result.deletedIds
                });
            }

            // GET /api/notifications
            if (pathname === '/api/notifications' && method === 'GET') {
                const user = getAuthUser(req);
                if (!user) {
                    return sendError(res, 401, 'Unauthorized');
                }
                const notifs = db.getNotifications(user.email, user.role);
                return sendJson(res, 200, notifs);
            }

            // POST /api/notifications/clear
            if (pathname === '/api/notifications/clear' && method === 'POST') {
                const user = getAuthUser(req);
                if (!user) {
                    return sendError(res, 401, 'Unauthorized');
                }
                db.clearNotifications(user.email);
                return sendJson(res, 200, { success: true });
            }

            // GET /api/ai/status
            // GET /api/ai/status (Fetch status of AI prioritisation assistant)
            if (pathname === '/api/ai/status' && method === 'GET') {
                const geminiKey = getGeminiApiKey();
                if (geminiKey) {
                    return sendJson(res, 200, {
                        hasKey: true,
                        type: 'gemini',
                        model: 'gemini-1.5-flash',
                        provider: 'Google Gemini Flash AI (Text Prioritisation Active 🟢)',
                        keyPreview: `${geminiKey.slice(0, 6)}...${geminiKey.slice(-4)}`
                    });
                }

                const groqKey = getGroqApiKey();
                if (groqKey) {
                    return sendJson(res, 200, {
                        hasKey: true,
                        type: 'groq',
                        model: 'llama-3.3-70b-versatile',
                        provider: 'Groq Llama 3 AI (Text Prioritisation Active 🟢)',
                        keyPreview: `${groqKey.slice(0, 7)}...${groqKey.slice(-4)}`
                    });
                }

                return sendJson(res, 200, {
                    hasKey: false,
                    type: 'none',
                    model: 'Deterministic Rule Engine',
                    provider: 'Deterministic Rule Engine (AI Key Optional)',
                    keyPreview: null
                });
            }

            // POST /api/ai/config (Save or update Gemini or Groq API key)
            if (pathname === '/api/ai/config' && method === 'POST') {
                const body = await readJsonBody(req);
                const { apiKey, type } = body;
                if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
                    return sendError(res, 400, 'Please provide a valid AI API key.');
                }
                const cleanedKey = apiKey.trim();
                const isGroq = type === 'groq' || cleanedKey.startsWith('gsk_');
                if (isGroq) {
                    db.setSetting('groq_api_key', cleanedKey);
                    return sendJson(res, 200, {
                        success: true,
                        provider: 'groq',
                        message: 'Groq AI key saved for text prioritisation! 🚀',
                        keyPreview: `${cleanedKey.slice(0, 7)}...${cleanedKey.slice(-4)}`
                    });
                } else {
                    db.setSetting('gemini_api_key', cleanedKey);
                    return sendJson(res, 200, {
                        success: true,
                        provider: 'gemini',
                        message: 'Google Gemini AI key saved for text prioritisation! 🚀',
                        keyPreview: `${cleanedKey.slice(0, 6)}...${cleanedKey.slice(-4)}`
                    });
                }
            }

            // DELETE /api/ai/config (Remove saved API key)
            if (pathname === '/api/ai/config' && method === 'DELETE') {
                db.setSetting('gemini_api_key', '');
                db.setSetting('groq_api_key', '');
                return sendJson(res, 200, { success: true, message: 'AI API keys cleared.' });
            }

            // GET /api/map-config (Fetch configured map service: MapTiler primary, Google Maps fallback)
            if (pathname === '/api/map-config' && method === 'GET') {
                const maptilerKey = getMapTilerApiKey();
                const googleKey = getGoogleMapsApiKey();
                const provider = maptilerKey ? 'maptiler' : (googleKey ? 'google' : 'osm');
                return sendJson(res, 200, {
                    provider,
                    maptilerKey: maptilerKey || null,
                    googleMapsKey: googleKey || null,
                    hasKey: Boolean(maptilerKey || googleKey)
                });
            }

            // POST /api/map-config (Save map configuration)
            if (pathname === '/api/map-config' && method === 'POST') {
                const body = await readJsonBody(req);
                const { maptilerKey, googleMapsKey } = body;
                if (maptilerKey && typeof maptilerKey === 'string') {
                    db.setSetting('maptiler_api_key', maptilerKey.trim());
                    process.env.MAPTILER_API_KEY = maptilerKey.trim();
                }
                if (googleMapsKey && typeof googleMapsKey === 'string') {
                    db.setSetting('google_maps_api_key', googleMapsKey.trim());
                    process.env.GOOGLE_MAPS_API_KEY = googleMapsKey.trim();
                }
                return sendJson(res, 200, { success: true, message: 'Map credentials updated.' });
            }

            // GET /api/config/maps (Backwards compatibility for Google Maps key)
            if (pathname === '/api/config/maps' && method === 'GET') {
                const mapsKey = getGoogleMapsApiKey();
                return sendJson(res, 200, {
                    hasKey: Boolean(mapsKey),
                    key: mapsKey || '',
                    keyPreview: mapsKey ? `${mapsKey.slice(0, 6)}...${mapsKey.slice(-4)}` : null
                });
            }

            // POST /api/config/maps (Backwards compatibility for Google Maps key)
            if (pathname === '/api/config/maps' && method === 'POST') {
                const body = await readJsonBody(req);
                const { apiKey } = body;
                if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
                    return sendError(res, 400, 'Please provide a valid Google Maps API key.');
                }
                const cleanedKey = apiKey.trim();
                process.env.GOOGLE_MAPS_API_KEY = cleanedKey;
                db.setSetting('google_maps_api_key', cleanedKey);
                return sendJson(res, 200, {
                    success: true,
                    message: 'Google Maps API key saved! 🗺️',
                    keyPreview: `${cleanedKey.slice(0, 6)}...${cleanedKey.slice(-4)}`
                });
            }

            // POST /api/ai/priority-explanation (AI Used ONLY for Food Prioritisation - Text Only)
            if (pathname === '/api/ai/priority-explanation' && method === 'POST') {
                const body = await readJsonBody(req);
                const { foodName, foodType, quantity, expiryDate, preparedDate } = body;

                if (!expiryDate || typeof expiryDate !== 'string') {
                    return sendError(res, 400, 'Expiry date is required for priority calculation.');
                }

                // Strictly prohibit any image data from being sent to AI
                if (body.image || body.photo || body.imageBase64) {
                    return sendError(res, 400, 'Food images must never be sent to the AI service. AI is strictly reserved for text prioritisation.');
                }

                const result = await generateAIPriorityExplanation({
                    foodName: foodName ? String(foodName).trim() : 'Food Listing',
                    foodType: foodType || 'General',
                    quantity: Number(quantity) || 1,
                    expiryDate,
                    preparedDate
                });

                return sendJson(res, 200, result);
            }

            // POST /api/ai/analyze-image (Obsolete Vision endpoint - safely disabled)
            if (pathname === '/api/ai/analyze-image' && method === 'POST') {
                return sendError(res, 400, 'Image analysis is disabled. Under ShareBite food safety rules, AI is used strictly for food prioritisation and expiry urgency, never image inspection.');
            }

            // POST /api/reset-demo or /api/reset-data
            if ((pathname === '/api/reset-demo' || pathname === '/api/reset-data') && method === 'POST') {
                db.resetDatabase();
                return sendJson(res, 200, { success: true, message: 'Database reset successfully.' });
            }

            // Unknown API endpoint
            return sendError(res, 404, `Endpoint ${method} ${pathname} not found`);
        } catch (apiErr) {
            console.error('API Error:', apiErr);
            return sendError(res, 500, 'Internal Server Error: ' + apiErr.message);
        }
    }

    // ---------------------------------------------------------
    // STATIC FILE SERVER
    // ---------------------------------------------------------
    let reqPath = pathname;
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, safePath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const totalSize = stats.size;
        const range = req.headers.range;

        if (range && (ext === '.mp4' || ext === '.webm')) {
            const parts = range.replace(/bytes=/, '').split('-');
            let start = parseInt(parts[0], 10);
            let end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

            if (isNaN(start) || start < 0) {
                start = 0;
            }
            if (isNaN(end) || end >= totalSize) {
                end = totalSize - 1;
            }
            if (start > end) {
                start = 0;
                end = totalSize - 1;
            }

            const chunkSize = (end - start) + 1;
            const fileStream = fs.createReadStream(filePath, { start, end });
            fileStream.on('error', () => {
                if (!res.headersSent) res.writeHead(500);
                res.end();
            });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType
            });
            fileStream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': totalSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes'
            });
            fs.createReadStream(filePath).pipe(res);
        }
    });
}

const server = http.createServer(requestHandler);

function startServer(port) {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`⚠️ Port ${port} is currently busy. Trying port ${Number(port) + 1}...`);
            startServer(Number(port) + 1);
        } else {
            console.error('Server error:', err);
        }
    });

    server.listen(port, () => {
        console.log(`\n======================================================`);
        console.log(`  🍃 ShareBite Full-Stack Web Application`);
        console.log(`  🌐 Server running at: http://localhost:${port}`);
        console.log(`  📦 SQLite Database: foodshare.db`);
        console.log(`======================================================\n`);
    });
}

if (!process.env.VERCEL) {
    startServer(PORT);
}

// Automatically purge expired food donations every 60 seconds
const EXPIRED_FOOD_PURGE_INTERVAL_MS = 60 * 1000;
const purgeTimer = setInterval(() => {
    try {
        const result = db.purgeExpiredDonations();
        if (result && result.deletedCount > 0) {
            console.log(`[Auto-Delete] Periodically purged ${result.deletedCount} expired donation(s) from database.`);
        }
    } catch (err) {
        console.error('Scheduled purge error:', err.message);
    }
}, EXPIRED_FOOD_PURGE_INTERVAL_MS);

if (purgeTimer.unref) {
    purgeTimer.unref();
}

module.exports = requestHandler;

