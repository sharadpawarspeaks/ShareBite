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

const FOOD_INSPECTION_PROMPT = `You are an expert food safety inspector and donation coordinator for a food rescue and surplus sharing platform.
Inspect this uploaded image with STRICT SCRUTINY.

STEP 1: MANDATORY FOOD VERIFICATION
Determine whether this image actually contains GENUINE, EDIBLE FOOD, fresh produce, groceries, raw ingredients, vegetables, fruits, cooked meals, bakery goods, packaged food products, or beverages intended for human consumption.

NON-FOOD DETECTION (STRICT REJECTION):
If this image depicts ANYTHING other than edible food:
- Examples of non-food: humans/faces/selfies, animals/pets, cars, smartphones, computers, screens, electronics, furniture, books, clothing, documents, memes, packaging with NO food inside, empty plates/tables/surfaces, random inanimate household objects, blurry/dark/unintelligible images.
- If it is NOT food:
  * Set "isFood": false
  * Set "rejectionReason": "Clear, informative explanation stating what is visible instead of food and explaining that only genuine food photos are accepted (e.g. 'This image shows a laptop/person/desk and does not contain edible food. Please upload a clear photo of the food you wish to donate.')."
  * Set "foodName": "Non-food item"
  * Set "isSafeForDonation": false

STEP 2: FOOD SAFETY AND SPOILAGE INSPECTION (Only if isFood is true)
Examine the physical condition of the food:
- If the food is visibly rotten, decaying, decomposed, moldy, infested with insects, contaminated, or unsafe for consumption:
  * Set "isFood": true
  * Set "isSafeForDonation": false
  * Set "safetyWarning": "Spoiled or moldy food detected. To protect recipient health, spoiled food cannot be accepted for donation."
  * Set "rejectionReason": "Food appears spoiled, contaminated, or unsafe for human consumption."
- If the food is fresh, wholesome, safe, and edible:
  * Set "isFood": true
  * Set "isSafeForDonation": true
  * Set "safetyWarning": null
  * Set "rejectionReason": null

STEP 3: CATEGORIZATION AND ESTIMATION (When isFood is true and isSafeForDonation is true)
- "foodName": A concise, natural name for the food (e.g., 'Fresh Braeburn Apples', 'Vegetable Biryani Rice', 'Artisan Bakery Loaves').
- "foodType": Exactly one of: 'Cooked Food', 'Packaged Food', 'Fruits', 'Vegetables', 'Bakery Items', 'Dairy Products', 'Other'.
- "estimatedQuantityKg": Realistic estimate in kilograms (number).
- "visualFreshness": Exactly one of: 'Fresh', 'Good Condition', 'Perishable - Fast Distribution Needed', 'Questionable / Unsafe'.
- "priority": Exactly one of: 'High', 'Medium', 'Low'.
- "suggestedExpiryDays": Estimated days remaining before expiration (integer).
- "description": 1 to 2 detailed sentences describing visible ingredients, packaging, freshness signs, and food handling recommendations.
- "confidence": Float between 0.0 and 1.0.

OUTPUT FORMAT:
Return STRICTLY a valid JSON object matching this schema without any markdown formatting or surrounding explanation:
{
  "isFood": true,
  "rejectionReason": null,
  "safetyWarning": null,
  "foodName": "Concise food name",
  "foodType": "Cooked Food",
  "estimatedQuantityKg": 5.0,
  "visualFreshness": "Fresh",
  "isSafeForDonation": true,
  "priority": "High",
  "suggestedExpiryDays": 2,
  "description": "...",
  "confidence": 0.95
}`;

async function analyzeFoodImageWithGroq(imageBase64, apiKey) {
    const candidateModels = ['llama-3.2-11b-vision-preview', 'llama-3.2-90b-vision-preview'];
    let lastError = null;
    const trimmedKey = apiKey.trim();

    let formattedImageUrl = imageBase64;
    if (!formattedImageUrl.startsWith('data:image/')) {
        formattedImageUrl = `data:image/jpeg;base64,${formattedImageUrl}`;
    }

    for (const model of candidateModels) {
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${trimmedKey}`
                },
                body: JSON.stringify({
                    model: model,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: `${FOOD_INSPECTION_PROMPT}\n\nIMPORTANT: Inspect this uploaded food image and respond strictly in valid JSON matching the schema.`
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: formattedImageUrl
                                    }
                                }
                            ]
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 800
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                lastError = new Error(`Groq API error (${response.status}): ${errorText}`);
                continue;
            }

            const data = await response.json();
            const rawContent = data.choices?.[0]?.message?.content;
            if (!rawContent) {
                throw new Error('No content returned by Groq Vision model');
            }

            let cleaned = rawContent.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleaned = cleaned.substring(firstBrace, lastBrace + 1);
            }

            const parsed = JSON.parse(cleaned);
            return {
                isFood: Boolean(parsed.isFood),
                rejectionReason: parsed.rejectionReason || null,
                safetyWarning: parsed.safetyWarning || null,
                foodName: parsed.foodName || (parsed.isFood ? 'Donated Food Item' : 'Non-Food Item'),
                foodType: parsed.foodType || 'Cooked Food',
                estimatedQuantityKg: Number(parsed.estimatedQuantityKg) || 1.0,
                visualFreshness: parsed.visualFreshness || 'Fresh',
                isSafeForDonation: Boolean(parsed.isSafeForDonation),
                priority: parsed.priority || 'Medium',
                suggestedExpiryDays: Number(parsed.suggestedExpiryDays) || 2,
                description: parsed.description || '',
                confidence: Number(parsed.confidence) || 0.95,
                activeModel: model
            };
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error('Failed to analyze food image with Groq Vision AI');
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

                try {
                    // Backend calculates priority exclusively from expiry date
                    const donation = db.createDonation({
                        foodName: foodName.trim(),
                        foodType,
                        quantity: numQuantity,
                        preparedDate: parsedPrepared.iso,
                        expiryDate: parsedExpiry.iso,
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
            if (pathname === '/api/ai/status' && method === 'GET') {
                const groqKey = getGroqApiKey();
                if (groqKey) {
                    return sendJson(res, 200, {
                        hasKey: true,
                        type: 'groq',
                        model: 'llama-3.2-11b-vision-preview',
                        provider: 'Groq Llama 3.2 Vision AI (Active 🟢)',
                        keyPreview: `${groqKey.slice(0, 7)}...${groqKey.slice(-4)}`
                    });
                }

                return sendJson(res, 200, {
                    hasKey: false,
                    type: 'none',
                    model: 'llama-3.2-11b-vision-preview',
                    provider: 'Groq Vision AI (Key Required 🔑)',
                    keyPreview: null
                });
            }

            // POST /api/ai/config (Save or update Groq API key)
            if (pathname === '/api/ai/config' && method === 'POST') {
                const body = await readJsonBody(req);
                const { apiKey } = body;
                if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
                    return sendError(res, 400, 'Please provide a valid Groq API key (starts with gsk_...).');
                }
                const cleanedKey = apiKey.trim();
                db.setSetting('groq_api_key', cleanedKey);
                return sendJson(res, 200, {
                    success: true,
                    message: 'Groq Vision AI key saved & activated! 🚀',
                    keyPreview: `${cleanedKey.slice(0, 7)}...${cleanedKey.slice(-4)}`
                });
            }

            // DELETE /api/ai/config (Remove saved API key)
            if (pathname === '/api/ai/config' && method === 'DELETE') {
                db.setSetting('groq_api_key', '');
                return sendJson(res, 200, { success: true, message: 'Groq API key cleared.' });
            }

            // GET /api/config/maps (Fetch configured Google Maps API key)
            if (pathname === '/api/config/maps' && method === 'GET') {
                const mapsKey = getGoogleMapsApiKey();
                return sendJson(res, 200, {
                    hasKey: Boolean(mapsKey),
                    key: mapsKey || '',
                    keyPreview: mapsKey ? `${mapsKey.slice(0, 6)}...${mapsKey.slice(-4)}` : null
                });
            }

            // POST /api/config/maps (Save Google Maps API key)
            if (pathname === '/api/config/maps' && method === 'POST') {
                const body = await readJsonBody(req);
                const { apiKey } = body;
                if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
                    return sendError(res, 400, 'Please provide a valid Google Maps API key.');
                }
                const cleanedKey = apiKey.trim();
                process.env.GOOGLE_MAPS_API_KEY = cleanedKey;
                db.setSetting('google_maps_api_key', cleanedKey);
                try {
                    const envPath = path.join(__dirname, '.env');
                    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
                    if (content.includes('GOOGLE_MAPS_API_KEY=')) {
                        content = content.replace(/GOOGLE_MAPS_API_KEY=.*/, `GOOGLE_MAPS_API_KEY="${cleanedKey}"`);
                    } else {
                        content += `\nGOOGLE_MAPS_API_KEY="${cleanedKey}"\n`;
                    }
                    fs.writeFileSync(envPath, content, 'utf8');
                } catch {}
                return sendJson(res, 200, {
                    success: true,
                    message: 'Google Maps API key saved! 🗺️',
                    keyPreview: `${cleanedKey.slice(0, 6)}...${cleanedKey.slice(-4)}`
                });
            }

            // POST /api/ai/analyze-image (Real AI Food Vision Inspection via Groq)
            if (pathname === '/api/ai/analyze-image' && method === 'POST') {
                const body = await readJsonBody(req);
                const { image, apiKey: directKey } = body;

                if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
                    return sendError(res, 400, 'Valid image data is required for AI inspection.');
                }

                const apiKey = (directKey && typeof directKey === 'string' && directKey.trim()) || getGroqApiKey();

                if (!apiKey) {
                    return sendError(res, 400, 'API_KEY_REQUIRED: Real AI Vision requires a Groq API key. Please add your GROQ_API_KEY in the .env file.');
                }

                try {
                    const analysis = await analyzeFoodImageWithGroq(image, apiKey);
                    return sendJson(res, 200, {
                        ...analysis,
                        aiProvider: `Groq Vision AI (${analysis.activeModel || 'llama-3.2-11b-vision-preview'})`
                    });
                } catch (groqErr) {
                    console.error('Groq Vision inspection failed:', groqErr.message);
                    return sendError(res, 502, 'Groq Vision AI Error: ' + groqErr.message);
                }
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

module.exports = requestHandler;

