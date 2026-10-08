const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = path.join(__dirname, 'foodshare.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for better concurrency and foreign keys
db.exec('PRAGMA foreign_keys = ON;');

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
            priority TEXT NOT NULL CHECK(priority IN ('High', 'Medium', 'Low', 'Expired')),
            status TEXT NOT NULL DEFAULT 'Available' CHECK(status IN ('Available', 'Accepted', 'Completed', 'Cancelled')),
            accepted_by_id INTEGER,
            accepted_by_name TEXT,
            accepted_by_email TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            accepted_at TEXT,
            completed_at TEXT,
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

        CREATE INDEX IF NOT EXISTS idx_donations_status ON donations(status);
        CREATE INDEX IF NOT EXISTS idx_donations_donor ON donations(donor_email);
        CREATE INDEX IF NOT EXISTS idx_donations_accepted ON donations(accepted_by_email);
        CREATE INDEX IF NOT EXISTS idx_notifications_email ON notifications(user_email);
    `);

    // Seed default users and donations if empty
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users;').get().count;
    if (userCount === 0) {
        seedInitialData();
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

    const donorInfo = insertUser.run('Sarah Jenkins', 'donor@foodshare.org', donorHash, 'donor');
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
// Mapping Helpers
// -------------------------------------------------------------
function mapDonation(row) {
    if (!row) return null;
    return {
        id: row.id,
        donorId: row.donor_id,
        donorName: row.donor_name,
        donorEmail: row.donor_email,
        foodName: row.food_name,
        foodType: row.food_type,
        quantity: row.quantity,
        preparedDate: row.prepared_date,
        expiryDate: row.expiry_date,
        pickupLocation: row.pickup_location,
        description: row.description || '',
        image: row.image,
        priority: row.priority,
        status: row.status,
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

function authenticateUser(email, password, role = null) {
    const user = getUserByEmail(email);
    if (!user) return null;
    if (role && user.role !== role) return null;
    if (!verifyPassword(password, user.password_hash)) return null;

    return mapUser(user);
}

// -------------------------------------------------------------
// Session Operations
// -------------------------------------------------------------
function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?);').run(token, userId);
    return token;
}

function getUserByToken(token) {
    if (!token) return null;
    const row = db.prepare(`
        SELECT u.id, u.name, u.email, u.role, u.created_at
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ?;
    `).get(token);
    return mapUser(row);
}

function deleteSession(token) {
    if (!token) return;
    db.prepare('DELETE FROM sessions WHERE token = ?;').run(token);
}

// -------------------------------------------------------------
// Donation Operations
// -------------------------------------------------------------
function getDonations(filters = {}) {
    let sql = 'SELECT * FROM donations WHERE 1=1';
    const params = [];

    if (filters.status) {
        sql += ' AND status = ?';
        params.push(filters.status);
    }

    if (filters.donorEmail) {
        sql += ' AND LOWER(donor_email) = LOWER(?)';
        params.push(filters.donorEmail);
    }

    if (filters.acceptedBy) {
        sql += ' AND LOWER(accepted_by_email) = LOWER(?)';
        params.push(filters.acceptedBy);
    }

    if (filters.foodType) {
        sql += ' AND food_type = ?';
        params.push(filters.foodType);
    }

    if (filters.search) {
        const query = `%${filters.search.toLowerCase()}%`;
        sql += ' AND (LOWER(food_name) LIKE ? OR LOWER(pickup_location) LIKE ? OR LOWER(description) LIKE ? OR LOWER(food_type) LIKE ?)';
        params.push(query, query, query, query);
    }

    if (filters.sort === 'priority') {
        sql += ` ORDER BY 
            CASE priority 
                WHEN 'High' THEN 1 
                WHEN 'Medium' THEN 2 
                WHEN 'Low' THEN 3 
                ELSE 4 
            END ASC, created_at DESC`;
    } else if (filters.sort === 'quantity') {
        sql += ' ORDER BY quantity DESC';
    } else {
        sql += ' ORDER BY created_at DESC';
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(mapDonation);
}

function getDonationById(id) {
    const row = db.prepare('SELECT * FROM donations WHERE id = ?;').get(id);
    return mapDonation(row);
}

function createDonation(data, user) {
    const stmt = db.prepare(`
        INSERT INTO donations (
            donor_id, donor_name, donor_email, food_name, food_type, quantity,
            prepared_date, expiry_date, pickup_location, description, image,
            priority, status, created_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, 'Available', ?
        );
    `);

    const now = new Date().toISOString();
    const info = stmt.run(
        user.id,
        user.name,
        user.email,
        data.foodName,
        data.foodType,
        Number(data.quantity),
        data.preparedDate,
        data.expiryDate,
        data.pickupLocation,
        data.description || '',
        data.image,
        data.priority || 'Medium',
        now
    );

    const donationId = info.lastInsertRowid;

    // Create notification for donor
    addNotification(
        user.email,
        'donor',
        'Donation Submitted 🍱',
        `"${data.foodName}" (${data.quantity} kg) is now live on ShareBite. Local NGOs can discover and request collection.`
    );

    return getDonationById(donationId);
}

function acceptDonation(donationId, ngoUser) {
    const donation = getDonationById(donationId);
    if (!donation) {
        throw new Error('Donation not found.');
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
    const totalFoodRow = db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) as totalFood, COUNT(*) as count 
        FROM donations 
        WHERE status != 'Cancelled';
    `).get();

    const completedRow = db.prepare(`
        SELECT COUNT(*) as completedCount, COALESCE(SUM(quantity), 0) as completedFood 
        FROM donations 
        WHERE status = 'Completed';
    `).get();

    const availableRow = db.prepare(`
        SELECT COUNT(*) as availableCount 
        FROM donations 
        WHERE status = 'Available';
    `).get();

    const totalFood = Number(totalFoodRow.totalFood || 0);
    const totalMeals = Math.round(totalFood * 4);

    return {
        totalFood: Number(totalFood.toFixed(1)),
        totalMeals,
        totalDonations: totalFoodRow.count,
        completedCount: completedRow.completedCount,
        completedFood: Number(Number(completedRow.completedFood || 0).toFixed(1)),
        availableCount: availableRow.availableCount
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
        DELETE FROM users;
    `);
    seedInitialData();
    return { success: true };
}

// Initialize tables on startup
initSchema();

module.exports = {
    getUserByEmail,
    getUserById,
    createUser,
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
    getStats,
    getNotifications,
    addNotification,
    clearNotifications,
    getSetting,
    setSetting,
    resetDatabase
};
