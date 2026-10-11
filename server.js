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
    '.webm': 'video/webm'
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

function getGeminiApiKey() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || db.getSetting('gemini_api_key') || null;
}

async function analyzeFoodImageWithGemini(imageBase64, apiKey) {
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
    const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    const candidateModels = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash'];
    let lastError = null;

    const promptText = `
You are an expert food safety inspector and donation coordinator for a food rescue and surplus sharing platform.
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
}
`;

    const payload = {
        contents: [
            {
                parts: [
                    { text: promptText },
                    {
                        inline_data: {
                            mime_type: mimeType,
                            data: cleanBase64
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1
        }
    };

    const trimmedKey = apiKey.trim();

    for (const model of candidateModels) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(trimmedKey)}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                // If model not found (404), fall through to next candidate model
                if (response.status === 404 && candidateModels.indexOf(model) < candidateModels.length - 1) {
                    lastError = new Error(`Model ${model} not available: ${errorText}`);
                    continue;
                }
                throw new Error(`Google Gemini API error (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!candidateText) {
                throw new Error('No response text received from Gemini Vision model');
            }

            // Extract JSON cleanly
            let cleaned = candidateText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleaned = cleaned.substring(firstBrace, lastBrace + 1);
            }

            const result = JSON.parse(cleaned);
            result.isFood = Boolean(result.isFood);
            result.isSafeForDonation = result.isFood && (result.isSafeForDonation !== false);
            result.activeModel = model;
            return result;
        } catch (err) {
            lastError = err;
            if (model === candidateModels[candidateModels.length - 1]) {
                throw lastError;
            }
        }
    }

    throw lastError || new Error('Failed to analyze image with Google Gemini Vision');
}

// -------------------------------------------------------------
// Server Request Handler
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
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
                const { foodName, foodType, quantity, preparedDate, expiryDate, pickupLocation, description, image, priority } = body;

                if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
                    return sendError(res, 400, 'Uploading a verified food image is mandatory. Please upload an image of the food you want to donate.');
                }

                if (!foodName || !foodType || !quantity || !preparedDate || !expiryDate || !pickupLocation) {
                    return sendError(res, 400, 'Please complete all required fields.');
                }

                if (Number(quantity) <= 0 || isNaN(Number(quantity))) {
                    return sendError(res, 400, 'Quantity must be a positive number.');
                }

                if (new Date(expiryDate) < new Date(preparedDate)) {
                    return sendError(res, 400, 'Expiry date cannot be before prepared date.');
                }

                const donation = db.createDonation({
                    foodName: foodName.trim(),
                    foodType,
                    quantity: Number(quantity),
                    preparedDate,
                    expiryDate,
                    pickupLocation: pickupLocation.trim(),
                    description: description ? description.trim() : '',
                    image,
                    priority: priority || 'Medium'
                }, user);

                return sendJson(res, 201, donation);
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
                const key = getGeminiApiKey();
                return sendJson(res, 200, {
                    hasKey: Boolean(key),
                    model: 'gemini-1.5-flash / gemini-2.0-flash',
                    provider: key ? 'Google Gemini Vision AI (Active 🟢)' : 'Google Gemini Vision AI (Key Required 🔑)',
                    keyPreview: key ? `${key.slice(0, 6)}...${key.slice(-4)}` : null
                });
            }

            // POST /api/ai/config (Save or update Gemini API key)
            if (pathname === '/api/ai/config' && method === 'POST') {
                const body = await readJsonBody(req);
                const { apiKey } = body;
                if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
                    return sendError(res, 400, 'Please provide a valid Gemini API key (typically starts with AIzaSy...).');
                }
                const cleanedKey = apiKey.trim();
                db.setSetting('gemini_api_key', cleanedKey);
                return sendJson(res, 200, {
                    success: true,
                    message: 'Google Gemini Vision AI key saved & activated! 🚀',
                    keyPreview: `${cleanedKey.slice(0, 6)}...${cleanedKey.slice(-4)}`
                });
            }

            // DELETE /api/ai/config (Remove saved API key)
            if (pathname === '/api/ai/config' && method === 'DELETE') {
                db.setSetting('gemini_api_key', '');
                return sendJson(res, 200, { success: true, message: 'Gemini API key cleared.' });
            }

            // POST /api/ai/analyze-image (Real AI Food Vision Inspection)
            if (pathname === '/api/ai/analyze-image' && method === 'POST') {
                const body = await readJsonBody(req);
                const { image, apiKey: directKey } = body;

                if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
                    return sendError(res, 400, 'Valid image data is required for AI inspection.');
                }

                const apiKey = (directKey && typeof directKey === 'string' && directKey.trim()) || getGeminiApiKey();

                if (!apiKey) {
                    return sendError(res, 400, 'API_KEY_REQUIRED: Real Gemini Vision AI requires an API key. Please connect your Gemini API key to inspect and verify food images.');
                }

                try {
                    const analysis = await analyzeFoodImageWithGemini(image, apiKey);
                    return sendJson(res, 200, {
                        ...analysis,
                        aiProvider: `Google Gemini Vision AI (${analysis.activeModel || 'gemini-1.5-flash'})`
                    });
                } catch (geminiErr) {
                    console.error('Gemini Vision inspection failed:', geminiErr.message);
                    return sendError(res, 502, 'Gemini Vision AI Error: ' + geminiErr.message);
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
});

server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  🍃 ShareBite Full-Stack Web Application`);
    console.log(`  🌐 Server running at: http://localhost:${PORT}`);
    console.log(`  📦 SQLite Database: foodshare.db`);
    console.log(`======================================================\n`);
});
