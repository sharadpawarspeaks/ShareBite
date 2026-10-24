const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dateUtils = require('./dateUtils.js');

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
let DB_PATH;

if (isVercel) {
    DB_PATH = path.join('/tmp', 'foodshare.db');
    const sourceCandidates = [
        path.join(process.cwd(), 'foodshare.db'),
        path.join(__dirname, 'foodshare.db'),
        path.join(__dirname, '..', 'foodshare.db')
    ];
    if (!fs.existsSync(DB_PATH)) {
        for (const candidate of sourceCandidates) {
            if (fs.existsSync(candidate)) {
                try {
                    fs.copyFileSync(candidate, DB_PATH);
                    break;
                } catch (copyErr) {
                    console.warn('Could not copy candidate DB to /tmp:', copyErr.message);
                }
            }
        }
    }
} else {
    DB_PATH = path.join(__dirname, 'foodshare.db');
}

let db;
try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA foreign_keys = ON;');
} catch (err) {
    console.error('DatabaseSync initialization failed:', err.message);
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
}


const DEFAULT_CATEGORY_IMAGES = {
    'Cooked Food': 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80',
    'Packaged Food': 'https://images.unsplash.com/photo-1588964895597-cfccd6e2dbf9?auto=format&fit=crop&w=800&q=80',
    'Fruits': 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=800&q=80',
    'Vegetables': 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80',
    'Bakery Items': 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80',
    'Dairy Products': 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=800&q=80'
};

// -------------------------------------------------------------
// Schema Initialization
// -------------------------------------------------------------
function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('donor', 'ngo')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS revoked_sessions (
            token TEXT PRIMARY KEY,
            revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS donations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            donor_id INTEGER NOT NULL,
            donor_name TEXT NOT NULL,
            donor_email TEXT NOT NULL,
            food_name TEXT NOT NULL,
            food_type TEXT NOT NULL,
            quantity REAL NOT NULL,
            prepared_date TEXT NOT NULL,
            expiry_date TEXT NOT NULL,
            pickup_location TEXT NOT NULL,
            description TEXT DEFAULT '',
            image TEXT NOT NULL,
            priority TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available', 'Accepted', 'Completed', 'Cancelled', 'Expired')),
            accepted_by_id INTEGER,
            accepted_by_name TEXT,
            accepted_by_email TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            accepted_at TEXT,
            completed_at TEXT,
            latitude REAL,
            longitude REAL,
            FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (accepted_by_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email TEXT NOT NULL,
            role TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            is_read INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            otp_hash TEXT NOT NULL,
            otp_expires_at TEXT NOT NULL,
            failed_attempts INTEGER NOT NULL DEFAULT 0,
            resend_available_at TEXT NOT NULL,
            is_verified INTEGER NOT NULL DEFAULT 0,
            reset_token_hash TEXT,
            reset_token_expires_at TEXT,
            used_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_donations_status ON donations(status);
        CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations(donor_email);
        CREATE INDEX IF NOT EXISTS idx_donations_accepted ON donations(accepted_by_email);
        CREATE INDEX IF NOT EXISTS idx_notifications_email ON notifications(user_email);
        CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
        CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
    `);

    // Ensure latitude and longitude columns exist
    try {
        db.exec(`ALTER TABLE donations ADD COLUMN latitude REAL;`);
    } catch (e) {}
    try {
        db.exec(`ALTER TABLE donations ADD COLUMN longitude REAL;`);
    } catch (e) {}

    // Migration: ensure donations table supports 'Expired' status and case-insensitive/new priority strings
    try {
        const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='donations';").get();
        if (tableInfo && tableInfo.sql && (!tableInfo.sql.includes("'Expired'") || tableInfo.sql.includes("CHECK(status IN ('Available', 'Accepted', 'Completed', 'Cancelled'))"))) {
            db.exec(`
                PRAGMA foreign_keys = OFF;
                CREATE TABLE IF NOT EXISTS donations_migrated (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    donor_id INTEGER NOT NULL,
                    donor_name TEXT NOT NULL,
                    donor_email TEXT NOT NULL,
                    food_name TEXT NOT NULL,
                    food_type TEXT NOT NULL,
                    quantity REAL NOT NULL,
                    prepared_date TEXT NOT NULL,
                    expiry_date TEXT NOT NULL,
                    pickup_location TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    image TEXT NOT NULL,
                    priority TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available', 'Accepted', 'Completed', 'Cancelled', 'Expired')),
                    accepted_by_id INTEGER,
                    accepted_by_name TEXT,
                    accepted_by_email TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    accepted_at TEXT,
                    completed_at TEXT,
                    latitude REAL,
                    longitude REAL,
                    FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (accepted_by_id) REFERENCES users(id) ON DELETE SET NULL
                );

                INSERT INTO donations_migrated (
                    id, donor_id, donor_name, donor_email, food_name, food_type, quantity,
                    prepared_date, expiry_date, pickup_location, description, image, priority, status,
                    accepted_by_id, accepted_by_name, accepted_by_email, created_at, accepted_at, completed_at, latitude, longitude
                )
                SELECT 
                    id, donor_id, donor_name, donor_email, food_name, food_type, quantity,
                    prepared_date, expiry_date, pickup_location, COALESCE(description, ''), image, priority, status,
                    accepted_by_id, accepted_by_name, accepted_by_email, created_at, accepted_at, completed_at, latitude, longitude
                FROM donations;

                DROP TABLE donations;
                ALTER TABLE donations_migrated RENAME TO donations;

                CREATE INDEX IF NOT EXISTS idx_donations_status ON donations(status);
                CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations(donor_email);
                CREATE INDEX IF NOT EXISTS idx_donations_accepted ON donations(accepted_by_email);
                PRAGMA foreign_keys = ON;
            `);
        }
    } catch (migErr) {
        console.warn('Donations migration note:', migErr.message);
    }

    // Seed default users and donations if empty on initial install
    const isSeeded = getSetting('db_seeded');
    if (!isSeeded) {
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users;').get().count;
        if (userCount === 0) {
            seedInitialData();
        }
        setSetting('db_seeded', '1');
    }
}

// -------------------------------------------------------------
// Password Hashing
// -------------------------------------------------------------
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    try {
        const [salt, originalHash] = stored.split(':');
        const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
        return hash === originalHash;
    } catch {
        return false;
    }
}

// -------------------------------------------------------------
// Initial Seed Data
// -------------------------------------------------------------
function seedInitialData() {
    const donorHash = hashPassword('password123');
    const ngoHash = hashPassword('password123');

    const insertUser = db.prepare(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES (?, ?, ?, ?);
    `);

    const donorInfo = insertUser.run('Community Donor', 'donor@foodshare.org', donorHash, 'donor');
    const donorId = donorInfo.lastInsertRowid;

    const ngoInfo = insertUser.run('Hope Community Shelter', 'ngo@foodshare.org', ngoHash, 'ngo');
    const ngoId = ngoInfo.lastInsertRowid;

    // Additional sample users
    const user2Info = insertUser.run('Rajesh Kumar', 'rajesh.donor@example.com', donorHash, 'donor');
    const user3Info = insertUser.run('Sunny Farms Market', 'contact@sunnyfarms.org', donorHash, 'donor');
    const user4Info = insertUser.run('Metro Grocers', 'depot@metrogrocers.com', donorHash, 'donor');

    // Welcome Notifications (No fake donations seeded)
    const insertNotif = db.prepare(`
        INSERT INTO notifications (user_email, role, title, message, created_at)
        VALUES (?, ?, ?, ?, ?);
    `);

    const now = new Date();
    insertNotif.run(
        'donor@foodshare.org', 'donor',
        'Welcome to ShareBite! 🍃',
        'Your food donation account is ready. Post surplus food to connect with local NGOs.',
        now.toLocaleString()
    );

    insertNotif.run(
        'ngo@foodshare.org', 'ngo',
        'Welcome to ShareBite! 🤝',
        'Your NGO account is ready. Browse food donations as donors post them.',
        now.toLocaleString()
    );
}

// -------------------------------------------------------------
// Auto-Delete Expired Food
// -------------------------------------------------------------
function purgeExpiredDonations(referenceDate = new Date()) {
    try {
        const rows = db.prepare(`
            SELECT id, donor_id, donor_name, donor_email, food_name, quantity, expiry_date, status, accepted_by_email
            FROM donations
            WHERE status != 'Completed';
        `).all();

        const deletedIds = [];
        const deleteStmt = db.prepare('DELETE FROM donations WHERE id = ?;');

        for (const row of rows) {
            let isExpired = false;
            if (row.status === 'Expired') {
                isExpired = true;
            } else {
                try {
                    const priorityInfo = dateUtils.calculateFoodPriority(row.expiry_date, referenceDate);
                    if (priorityInfo.isExpired) {
                        isExpired = true;
                    }
                } catch (e) {}
            }

            if (isExpired) {
                deleteStmt.run(row.id);
                deletedIds.push(row.id);

                // Notify donor about automatic deletion
                try {
                    addNotification(
                        row.donor_email,
                        'donor',
                        'Food Expired & Automatically Deleted 🗑️',
                        `Your listing "${row.food_name}" (${row.quantity} kg) reached its expiration date (${dateUtils.formatDateToDisplay(row.expiry_date)}) and has been automatically removed from the database for food safety compliance.`
                    );
                } catch (notifErr) {}

                // If an NGO had accepted it, notify the NGO that the food expired before pickup
                if (row.accepted_by_email) {
                    try {
                        addNotification(
                            row.accepted_by_email,
                            'ngo',
                            'Accepted Food Expired ⚠️',
                            `The accepted listing "${row.food_name}" from ${row.donor_name} reached its expiration date before collection and was automatically deleted from the database.`
                        );
                    } catch (notifErr) {}
                }

                console.log(`[Auto-Delete] Expired food item deleted from database: ID ${row.id} ("${row.food_name}", expiry: ${row.expiry_date})`);
            }
        }

        return {
            deletedCount: deletedIds.length,
            deletedIds
        };
    } catch (err) {
        console.error('Error in purgeExpiredDonations:', err.message);
        return { deletedCount: 0, deletedIds: [] };
    }
}

// -------------------------------------------------------------
// Mapping Helpers
// -------------------------------------------------------------
function mapDonation(row) {
    if (!row) return null;

    // Recalculate priority strictly from expiry date using current date (server single source of truth)
    const priorityInfo = dateUtils.calculateFoodPriority(row.expiry_date);
    let status = row.status;

    // If an uncompleted donation has expired, automatically delete it from database
    if (status !== 'Completed' && (priorityInfo.isExpired || status === 'Expired')) {
        status = 'Expired';
        try {
            db.prepare("DELETE FROM donations WHERE id = ?;").run(row.id);
            console.log(`[Auto-Delete] Expired donation automatically deleted from database: ID ${row.id} ("${row.food_name}")`);
        } catch (e) {}
    }

    return {
        id: row.id,
        donorId: row.donor_id,
        donorName: row.donor_name,
        donorEmail: row.donor_email,
        foodName: row.food_name,
        foodType: row.food_type,
        quantity: row.quantity,
        preparedDate: dateUtils.formatDateToISO(row.prepared_date) || row.prepared_date,
        preparedDateFormatted: dateUtils.formatDateToDisplay(row.prepared_date),
        expiryDate: dateUtils.formatDateToISO(row.expiry_date) || row.expiry_date,
        expiryDateFormatted: dateUtils.formatDateToDisplay(row.expiry_date),
        pickupLocation: row.pickup_location,
        latitude: row.latitude !== undefined && row.latitude !== null ? Number(row.latitude) : null,
        longitude: row.longitude !== undefined && row.longitude !== null ? Number(row.longitude) : null,
        description: row.description || '',
        image: row.image || DEFAULT_CATEGORY_IMAGES[row.food_type] || DEFAULT_CATEGORY_IMAGES['Cooked Food'],
        priority: priorityInfo.priority,
        priorityClass: priorityInfo.badgeClass,
        priorityBadge: priorityInfo.badgeLabel,
        daysRemaining: priorityInfo.daysRemaining,
        isExpired: priorityInfo.isExpired,
        expiresToday: priorityInfo.expiresToday,
        urgencyWarning: priorityInfo.warning,
        status: status,
        acceptedById: row.accepted_by_id,
        acceptedBy: row.accepted_by_email,
        acceptedByName: row.accepted_by_name,
        createdAt: row.created_at,
        acceptedAt: row.accepted_at,
        completedAt: row.completed_at
    };
}

function mapUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        createdAt: row.created_at
    };
}

// -------------------------------------------------------------
// User Operations
// -------------------------------------------------------------
function getUserByEmail(email) {
    const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?);').get(email);
    return row;
}

function getUserById(id) {
    const row = db.prepare('SELECT * FROM users WHERE id = ?;').get(id);
    return mapUser(row);
}

function createUser(name, email, password, role) {
    const existing = getUserByEmail(email);
    if (existing) {
        throw new Error('An account with this email already exists.');
    }
    const hash = hashPassword(password);
    const info = db.prepare(`
        INSERT INTO users (name, email, password_hash, role)
        VALUES (?, ?, ?, ?);
    `).run(name, email.toLowerCase(), hash, role);

    return {
        id: info.lastInsertRowid,
        name,
        email: email.toLowerCase(),
        role
    };
}

function findOrCreateOAuthUser(name, email, role = 'donor') {
    const cleanEmail = email.trim().toLowerCase();
    let user = getUserByEmail(cleanEmail);
    if (!user) {
        const dummyHash = hashPassword(crypto.randomBytes(16).toString('hex'));
        const cleanName = (name && name.trim()) ? name.trim() : cleanEmail.split('@')[0];
        const info = db.prepare(`
            INSERT INTO users (name, email, password_hash, role)
            VALUES (?, ?, ?, ?);
        `).run(cleanName, cleanEmail, dummyHash, role);

        user = {
            id: info.lastInsertRowid,
            name: cleanName,
            email: cleanEmail,
            role
        };

        try {
            const insertNotif = db.prepare(`
                INSERT INTO notifications (user_email, role, title, message, created_at)
                VALUES (?, ?, ?, ?, ?);
            `);
            insertNotif.run(
                cleanEmail,
                role,
                'Welcome to ShareBite! 🍃',
                `Successfully signed in with your verified account. Your ${role === 'donor' ? 'donor' : 'NGO'} profile is ready!`,
                new Date().toLocaleString()
            );
        } catch (e) {}
    }
    return user;
}


function authenticateUser(email, password, role = null) {
    const user = getUserByEmail(email);
    if (!user) return null;
    if (role && user.role !== role) return null;
    if (!verifyPassword(password, user.password_hash)) return null;

    return mapUser(user);
}

// -------------------------------------------------------------
// Session Operations (Persistent across refreshes & Vercel serverless lambdas)
// -------------------------------------------------------------
const SESSION_SECRET = process.env.SESSION_SECRET || 'sharebite-secure-hmac-session-token-key-2026';

function signSessionToken(userId, rawToken, passwordHashSnippet = '') {
    const payload = `${userId}:${Date.now()}:${rawToken}:${passwordHashSnippet}`;
    const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    return `sb_${Buffer.from(payload).toString('base64url')}_${hmac}`;
}

function verifySessionToken(signedToken) {
    if (!signedToken || typeof signedToken !== 'string') return null;
    if (!signedToken.startsWith('sb_')) return null;
    const parts = signedToken.split('_');
    if (parts.length !== 3) return null;
    const [, b64Payload, hmac] = parts;
    let payload;
    try {
        payload = Buffer.from(b64Payload, 'base64url').toString('utf8');
    } catch {
        return null;
    }
    const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    if (hmac.length !== expectedHmac.length || !crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) {
        return null;
    }
    const [userIdStr, timestampStr, rawToken, hashSnippet] = payload.split(':');
    const userId = Number(userIdStr);
    const timestamp = Number(timestampStr);
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    if (isNaN(userId) || isNaN(timestamp) || (Date.now() - timestamp > THIRTY_DAYS_MS)) {
        return null;
    }
    return { userId, rawToken, hashSnippet: hashSnippet || '', timestamp };
}

function createSession(userId) {
    const rawToken = crypto.randomBytes(24).toString('hex');
    let hashSnippet = '';
    try {
        const userRow = db.prepare('SELECT password_hash FROM users WHERE id = ?;').get(userId);
        if (userRow && userRow.password_hash) {
            hashSnippet = userRow.password_hash.slice(-12);
        }
    } catch {}

    const token = signSessionToken(userId, rawToken, hashSnippet);
    try {
        db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?);').run(token, userId);
    } catch (e) {
        // Fallback for constraint
    }
    return token;
}

function getUserByToken(token) {
    if (!token) return null;

    // Check if explicitly revoked
    try {
        const revoked = db.prepare('SELECT token FROM revoked_sessions WHERE token = ?;').get(token);
        if (revoked) return null;
    } catch {}

    // 1. Direct query in sessions table (works locally and within warm containers)
    try {
        const row = db.prepare(`
            SELECT u.id, u.name, u.email, u.role, u.password_hash, u.created_at
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?;
        `).get(token);
        if (row) return mapUser(row);
    } catch {}

    // 2. Cryptographic signature verification (persistent across serverless lambdas on Vercel)
    const verified = verifySessionToken(token);
    if (!verified) return null;

    try {
        const userRow = db.prepare(`
            SELECT id, name, email, role, password_hash, created_at
            FROM users
            WHERE id = ?;
        `).get(verified.userId);
        if (!userRow) return null;

        // If password was changed, hash snippet won't match; invalidate token
        if (verified.hashSnippet && userRow.password_hash) {
            const currentSnippet = userRow.password_hash.slice(-12);
            if (currentSnippet !== verified.hashSnippet) {
                return null;
            }
        }

        // Cache session in this container instance
        try {
            db.prepare('INSERT OR IGNORE INTO sessions (token, user_id) VALUES (?, ?);').run(token, verified.userId);
        } catch {}

        return mapUser(userRow);
    } catch {
        return null;
    }
}

function deleteSession(token) {
    if (!token) return;
    try {
        db.prepare('DELETE FROM sessions WHERE token = ?;').run(token);
    } catch {}
    try {
        db.prepare('INSERT OR IGNORE INTO revoked_sessions (token) VALUES (?);').run(token);
    } catch {}
}

// -------------------------------------------------------------
// Donation Operations
// -------------------------------------------------------------
function getDonations(filters = {}) {
    // Automatically purge expired food from database
    purgeExpiredDonations();

    let sql = `
        SELECT d.*, COALESCE(u.name, d.donor_name) AS donor_name
        FROM donations d
        LEFT JOIN users u ON d.donor_id = u.id
        WHERE 1=1
    `;
    const params = [];

    // Filter by specific status in DB if not 'Available' (available status is filtered in memory to exclude expired)
    if (filters.status && filters.status !== 'Available') {
        sql += ' AND d.status = ?';
        params.push(filters.status);
    }

    if (filters.donorEmail) {
        sql += ' AND LOWER(d.donor_email) = LOWER(?)';
        params.push(filters.donorEmail);
    }

    if (filters.acceptedBy) {
        sql += ' AND LOWER(d.accepted_by_email) = LOWER(?)';
        params.push(filters.acceptedBy);
    }

    if (filters.foodType) {
        sql += ' AND d.food_type = ?';
        params.push(filters.foodType);
    }

    if (filters.search) {
        const query = `%${filters.search.toLowerCase()}%`;
        sql += ' AND (LOWER(d.food_name) LIKE ? OR LOWER(d.pickup_location) LIKE ? OR LOWER(d.description) LIKE ? OR LOWER(d.food_type) LIKE ?)';
        params.push(query, query, query, query);
    }

    if (filters.sort === 'quantity') {
        sql += ' ORDER BY d.quantity DESC';
    } else {
        sql += ' ORDER BY d.created_at DESC';
    }

    const rows = db.prepare(sql).all(...params);
    let mapped = rows.map(mapDonation);

    // Expired food handling: expired food must NOT appear among Available donations
    if (filters.status === 'Available') {
        mapped = mapped.filter(d => d.status === 'Available' && !d.isExpired);
    } else if (filters.status === 'Expired') {
        mapped = mapped.filter(d => d.status === 'Expired' || d.isExpired);
    }

    // Urgency sorting: highest priority first, then earliest expiry date, then stable id
    if (filters.sort === 'priority') {
        mapped.sort((a, b) => dateUtils.compareDonationsByUrgency(a, b));
    }

    return mapped;
}

function getDonationById(id) {
    const row = db.prepare(`
        SELECT d.*, COALESCE(u.name, d.donor_name) AS donor_name
        FROM donations d
        LEFT JOIN users u ON d.donor_id = u.id
        WHERE d.id = ?;
    `).get(id);
    return mapDonation(row);
}

function createDonation(data, user) {
    if (!user) {
        user = getUserByEmail(data.donorEmail || 'donor@foodshare.org') || {
            id: 1,
            name: data.donorName || 'Community Member',
            email: data.donorEmail || 'donor@foodshare.org'
        };
    }

    if (!data.foodName || !data.foodName.trim()) {
        throw new Error('Food name is required.');
    }
    if (!data.foodType) {
        throw new Error('Food category is required.');
    }
    const quantity = Number(data.quantity);
    if (!quantity || isNaN(quantity) || quantity <= 0) {
        throw new Error('Quantity must be a positive number.');
    }
    if (!data.pickupLocation || !data.pickupLocation.trim()) {
        throw new Error('Pickup location is required.');
    }

    // Mandatory Expiry Date Validation
    if (!data.expiryDate) {
        throw new Error('Expiry date is required.');
    }
    const parsedExpiry = dateUtils.parseDateInput(data.expiryDate);
    if (!parsedExpiry.valid) {
        throw new Error(parsedExpiry.error || 'Invalid expiry date format. Please use DD/MM/YYYY.');
    }

    // Prepared Date Validation
    if (!data.preparedDate) {
        throw new Error('Prepared date is required.');
    }
    const parsedPrepared = dateUtils.parseDateInput(data.preparedDate);
    if (!parsedPrepared.valid) {
        throw new Error(parsedPrepared.error || 'Invalid prepared date format. Please use DD/MM/YYYY.');
    }
    if (parsedExpiry.iso < parsedPrepared.iso) {
        throw new Error('Expiry date cannot be before prepared date.');
    }

    // Mandatory Food Image Validation (Must be persistent image data or URL, not serverless /tmp)
    if (!data.image || typeof data.image !== 'string' || (!data.image.startsWith('data:image/') && !data.image.startsWith('http://') && !data.image.startsWith('https://'))) {
        throw new Error('Please upload a photo of the food before listing it.');
    }

    // Server-side food priority calculation based SOLELY on expiry date
    const priorityInfo = dateUtils.calculateFoodPriority(parsedExpiry.iso);
    const initialStatus = priorityInfo.isExpired ? 'Expired' : 'Available';

    const stmt = db.prepare(`
        INSERT INTO donations (
            donor_id, donor_name, donor_email, food_name, food_type, quantity,
            prepared_date, expiry_date, pickup_location, latitude, longitude, description, image,
            priority, status, created_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?
        );
    `);

    const now = new Date().toISOString();
    const info = stmt.run(
        user.id,
        user.name,
        user.email,
        data.foodName.trim(),
        data.foodType,
        quantity,
        parsedPrepared.iso,
        parsedExpiry.iso,
        data.pickupLocation.trim(),
        data.latitude !== undefined && data.latitude !== null && !isNaN(Number(data.latitude)) ? Number(data.latitude) : null,
        data.longitude !== undefined && data.longitude !== null && !isNaN(Number(data.longitude)) ? Number(data.longitude) : null,
        data.description ? data.description.trim() : '',
        data.image,
        priorityInfo.priority,
        initialStatus,
        now
    );

    const donationId = info.lastInsertRowid;

    // Create notification for donor
    addNotification(
        user.email,
        'donor',
        'Donation Submitted 🍱',
        `"${data.foodName}" (${quantity} kg) is now live on ShareBite. Local NGOs can discover and request collection.`
    );

    return getDonationById(donationId);
}

function acceptDonation(donationId, ngoUser) {
    const donation = getDonationById(donationId);
    if (!donation) {
        throw new Error('This donation has expired and was removed, or does not exist.');
    }

    // Expired donations must NOT be offered for redistribution or accepted
    if (donation.isExpired || donation.status === 'Expired') {
        throw new Error('This donation has expired and cannot be accepted for redistribution.');
    }

    if (donation.status !== 'Available') {
        throw new Error('This donation is no longer available.');
    }

    const now = new Date().toISOString();
    db.prepare(`
        UPDATE donations 
        SET status = 'Accepted', 
            accepted_by_id = ?, 
            accepted_by_name = ?, 
            accepted_by_email = ?,
            accepted_at = ?
        WHERE id = ?;
    `).run(ngoUser.id, ngoUser.name, ngoUser.email, now, donationId);

    // Notify Donor
    addNotification(
        donation.donorEmail,
        'donor',
        'Food Donation Accepted! 🤝',
        `Great news! "${donation.foodName}" has been accepted for collection by ${ngoUser.name}.`
    );

    // Notify NGO
    addNotification(
        ngoUser.email,
        'ngo',
        'Food Donation Accepted 🤝',
        `You accepted "${donation.foodName}" (${donation.quantity} kg) from ${donation.donorName}. Pickup location: ${donation.pickupLocation}.`
    );

    return getDonationById(donationId);
}

function completeDonation(donationId, user) {
    const donation = getDonationById(donationId);
    if (!donation) {
        throw new Error('Donation not found.');
    }
    if (donation.status !== 'Accepted') {
        throw new Error('Only accepted donations can be marked as completed.');
    }

    // Authorization check: only donor or the accepting NGO can mark complete
    const isDonor = user.email && donation.donorEmail && user.email.toLowerCase() === donation.donorEmail.toLowerCase();
    const isAcceptedNGO = donation.acceptedBy && user.email && donation.acceptedBy.toLowerCase() === user.email.toLowerCase();
    if (!isDonor && !isAcceptedNGO) {
        throw new Error('You are not authorized to update this donation.');
    }

    const now = new Date().toISOString();
    db.prepare(`
        UPDATE donations 
        SET status = 'Completed', 
            completed_at = ?
        WHERE id = ?;
    `).run(now, donationId);

    // Notify donor
    addNotification(
        donation.donorEmail,
        'donor',
        'Donation Completed & Delivered! 🌟',
        `Your food donation "${donation.foodName}" was successfully distributed by ${donation.acceptedByName || 'the NGO'}. Thank you!`
    );

    // Notify NGO
    if (donation.acceptedBy) {
        addNotification(
            donation.acceptedBy,
            'ngo',
            'Collection Completed 👏',
            `Distribution of "${donation.foodName}" (${donation.quantity} kg) marked as complete.`
        );
    }

    return getDonationById(donationId);
}

function cancelDonation(donationId, donorUser) {
    const donation = getDonationById(donationId);
    if (!donation) {
        throw new Error('Donation not found.');
    }
    if (donation.donorEmail.toLowerCase() !== donorUser.email.toLowerCase()) {
        throw new Error('You are not authorized to cancel this donation.');
    }
    if (donation.status === 'Accepted' || donation.status === 'Completed') {
        throw new Error('Cannot cancel a donation that is already accepted or completed.');
    }

    db.prepare('DELETE FROM donations WHERE id = ?;').run(donationId);

    addNotification(
        donorUser.email,
        'donor',
        'Donation Cancelled',
        `Your donation "${donation.foodName}" has been cancelled.`
    );

    return { success: true, id: donationId };
}

// -------------------------------------------------------------
// Stats & Impact
// -------------------------------------------------------------
function getStats() {
    // Automatically purge expired food before calculating statistics
    purgeExpiredDonations();

    // 1. Food actually redistributed: completed donations across all registered users
    const completedRow = db.prepare(`
        SELECT COUNT(*) as completedCount, COALESCE(SUM(quantity), 0) as completedFood 
        FROM donations 
        WHERE status = 'Completed';
    `).get();

    // 2. Total genuine food donations submitted through ShareBite across all users (excluding cancelled)
    const submittedRow = db.prepare(`
        SELECT COUNT(*) as totalDonations, COALESCE(SUM(quantity), 0) as totalListedFood 
        FROM donations 
        WHERE status != 'Cancelled';
    `).get();

    const availableRow = db.prepare(`
        SELECT COUNT(*) as availableCount 
        FROM donations 
        WHERE status = 'Available';
    `).get();

    const completedFood = Number(Number(completedRow ? (completedRow.completedFood || 0) : 0).toFixed(1));
    const completedMeals = Math.round(completedFood * 4);
    const completedCount = Number(completedRow ? (completedRow.completedCount || 0) : 0);
    const totalDonations = Number(submittedRow ? (submittedRow.totalDonations || 0) : 0);

    return {
        // Food successfully redistributed metrics (Food Shared & Meals Supported)
        totalFood: completedFood,
        totalMeals: completedMeals,
        completedFood,
        completedCount,

        // Total genuine food donations submitted across all users
        totalDonations,
        submittedCount: totalDonations,
        availableCount: availableRow ? Number(availableRow.availableCount || 0) : 0,

        conversionRate: '4 meals per kg of completed food',
        isLifetime: true
    };
}

// -------------------------------------------------------------
// Notifications
// -------------------------------------------------------------
function addNotification(userEmail, role, title, message) {
    db.prepare(`
        INSERT INTO notifications (user_email, role, title, message, created_at)
        VALUES (?, ?, ?, ?, datetime('now'));
    `).run(userEmail, role, title, message);
}

function getNotifications(userEmail, role) {
    const rows = db.prepare(`
        SELECT * FROM notifications 
        WHERE LOWER(user_email) = LOWER(?) AND role = ?
        ORDER BY id DESC;
    `).all(userEmail, role);

    return rows.map(r => ({
        id: r.id,
        email: r.user_email,
        role: r.role,
        title: r.title,
        message: r.message,
        time: r.created_at,
        isRead: Boolean(r.is_read)
    }));
}

function clearNotifications(userEmail) {
    db.prepare('DELETE FROM notifications WHERE LOWER(user_email) = LOWER(?);').run(userEmail);
    return { success: true };
}

// -------------------------------------------------------------
// Settings Operations
// -------------------------------------------------------------
function getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?;').get(key);
    return row ? row.value : null;
}

function setSetting(key, value) {
    db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `).run(key, String(value));
    return { success: true };
}

// -------------------------------------------------------------
// Reset Demo Data
// -------------------------------------------------------------
function resetDatabase() {
    db.exec(`
        DELETE FROM sessions;
        DELETE FROM notifications;
        DELETE FROM donations;
        DELETE FROM password_resets;
        DELETE FROM users;
    `);
    seedInitialData();
    return { success: true };
}

// -------------------------------------------------------------
// Password Reset Operations (Email OTP Verification)
// -------------------------------------------------------------

function hashOtp(otp) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(String(otp), salt, 1000, 32, 'sha256').toString('hex');
    return `${salt}:${hash}`;
}

function verifyOtp(otp, stored) {
    try {
        if (!otp || !stored || !stored.includes(':')) return false;
        const [salt, originalHash] = stored.split(':');
        const hash = crypto.pbkdf2Sync(String(otp), salt, 1000, 32, 'sha256').toString('hex');
        const hashBuf = Buffer.from(hash, 'hex');
        const origBuf = Buffer.from(originalHash, 'hex');
        if (hashBuf.length !== origBuf.length) return false;
        return crypto.timingSafeEqual(hashBuf, origBuf);
    } catch {
        return false;
    }
}

function hashToken(token) {
    if (!token) return '';
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function createPasswordResetRequest(user, otp) {
    if (!user || !otp) {
        throw new Error('User and OTP are required.');
    }

    // Invalidate prior pending OTP requests for this user
    db.prepare(`
        UPDATE password_resets
        SET used_at = datetime('now')
        WHERE user_id = ? AND used_at IS NULL;
    `).run(user.id);

    const otpHash = hashOtp(otp);
    const now = Date.now();
    const otpExpiresAt = new Date(now + 5 * 60 * 1000).toISOString(); // 5 minutes
    const resendAvailableAt = new Date(now + 60 * 1000).toISOString(); // 60 seconds

    const info = db.prepare(`
        INSERT INTO password_resets (
            user_id, email, otp_hash, otp_expires_at, failed_attempts,
            resend_available_at, is_verified, created_at
        ) VALUES (?, ?, ?, ?, 0, ?, 0, datetime('now'));
    `).run(user.id, user.email.toLowerCase(), otpHash, otpExpiresAt, resendAvailableAt);

    return {
        id: info.lastInsertRowid,
        userId: user.id,
        email: user.email.toLowerCase(),
        otpExpiresAt,
        resendAvailableAt
    };
}

function getLatestActiveResetRequest(email) {
    if (!email) return null;
    return db.prepare(`
        SELECT * FROM password_resets
        WHERE LOWER(email) = LOWER(?) AND used_at IS NULL
        ORDER BY id DESC LIMIT 1;
    `).get(email.trim());
}

function getRecentResetRequestsCount(email, withinHours = 1) {
    if (!email) return 0;
    const row = db.prepare(`
        SELECT COUNT(*) as count FROM password_resets
        WHERE LOWER(email) = LOWER(?)
          AND created_at >= datetime('now', '-' || ? || ' hours');
    `).get(email.trim(), withinHours);
    return row ? Number(row.count) : 0;
}

function recordFailedOtpAttempt(requestId) {
    db.prepare(`
        UPDATE password_resets
        SET failed_attempts = failed_attempts + 1
        WHERE id = ?;
    `).run(requestId);
    return db.prepare('SELECT * FROM password_resets WHERE id = ?;').get(requestId);
}

function markOtpVerified(requestId, resetTokenHash, tokenExpiresAt) {
    db.prepare(`
        UPDATE password_resets
        SET is_verified = 1,
            reset_token_hash = ?,
            reset_token_expires_at = ?
        WHERE id = ?;
    `).run(resetTokenHash, tokenExpiresAt, requestId);
}

function getValidResetRecordByToken(email, resetToken) {
    if (!email || !resetToken) return null;
    const tokenHash = hashToken(resetToken);
    return db.prepare(`
        SELECT * FROM password_resets
        WHERE LOWER(email) = LOWER(?)
          AND reset_token_hash = ?
          AND is_verified = 1
          AND used_at IS NULL
        ORDER BY id DESC LIMIT 1;
    `).get(email.trim(), tokenHash);
}

function completePasswordReset(userId, requestId, newPassword) {
    const newHash = hashPassword(newPassword);

    // Update the user's password securely
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?;').run(newHash, userId);

    // Consume this reset request and invalidate any remaining open requests for this user
    db.prepare(`
        UPDATE password_resets
        SET used_at = datetime('now')
        WHERE user_id = ? AND used_at IS NULL;
    `).run(userId);

    // Revoke all active sessions for this user (logs out previous logins)
    db.prepare('DELETE FROM sessions WHERE user_id = ?;').run(userId);

    // Add security audit notification
    const user = getUserById(userId);
    if (user) {
        try {
            db.prepare(`
                INSERT INTO notifications (user_email, role, title, message, created_at)
                VALUES (?, ?, ?, ?, datetime('now'));
            `).run(
                user.email,
                user.role,
                'Security Alert: Password Changed 🔒',
                'Your ShareBite account password was recently reset. All previous sessions have been signed out. If you did not make this change, please contact support immediately.'
            );
        } catch (e) {}
    }

    return { success: true };
}

function revokeAllSessionsForUser(userId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?;').run(userId);
    return { success: true };
}

function expireResetRequestForTesting(requestId) {
    const past = new Date(Date.now() - 1000 * 60 * 10).toISOString();
    db.prepare('UPDATE password_resets SET otp_expires_at = ? WHERE id = ?;').run(past, requestId);
}

function clearPasswordResetsForTesting() {
    db.prepare('DELETE FROM password_resets;').run();
}

// Clean up expired reset requests older than 24 hours
try {
    db.prepare("DELETE FROM password_resets WHERE created_at < datetime('now', '-24 hours');").run();
} catch (e) {}

// Initialize tables on startup
initSchema();

// Automatically purge expired food on database connection
purgeExpiredDonations();

module.exports = {
    getUserByEmail,
    getUserById,
    createUser,
    findOrCreateOAuthUser,
    authenticateUser,
    createSession,
    getUserByToken,
    deleteSession,
    getDonations,
    getDonationById,
    createDonation,
    acceptDonation,
    completeDonation,
    cancelDonation,
    purgeExpiredDonations,
    deleteExpiredDonations: purgeExpiredDonations,
    getStats,
    getNotifications,
    addNotification,
    clearNotifications,
    getSetting,
    setSetting,
    resetDatabase,
    // Password reset functions
    hashOtp,
    verifyOtp,
    hashToken,
    createPasswordResetRequest,
    getLatestActiveResetRequest,
    getRecentResetRequestsCount,
    recordFailedOtpAttempt,
    markOtpVerified,
    getValidResetRecordByToken,
    completePasswordReset,
    revokeAllSessionsForUser,
    expireResetRequestForTesting,
    clearPasswordResetsForTesting,
    clearDonationsForTesting: () => db.prepare('DELETE FROM donations;').run()
};
