/**
 * ShareBite Date and Food Priority Utilities
 * 
 * Rules:
 * - UI Date Format: DD/MM/YYYY (e.g., 16/10/2026)
 * - Database Storage: ISO YYYY-MM-DD (e.g., 2026-10-16)
 * - Priority Levels (Determined SOLELY by expiry date):
 *   1. CRITICAL: Food expired (daysRemaining < 0) or expires today (daysRemaining === 0)
 *   2. HIGH: Food expires in 1–2 days (daysRemaining 1 to 2)
 *   3. MEDIUM: Food expires in 3–5 days (daysRemaining 3 to 5)
 *   4. LOW: Food expires in more than 5 days (daysRemaining > 5)
 */

/**
 * Checks if a given day, month, year represents a real calendar date.
 * Handles month lengths and leap years correctly.
 */
function isValidCalendarDate(day, month, year) {
    if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
        return false;
    }
    if (year < 1900 || year > 2100) {
        return false;
    }
    if (month < 1 || month > 12) {
        return false;
    }
    // Days in month: year, month (1-indexed), day 0 returns last day of specified month
    const daysInMonth = new Date(year, month, 0).getDate();
    return day >= 1 && day <= daysInMonth;
}

/**
 * Parses a date string in DD/MM/YYYY or YYYY-MM-DD format.
 * Returns an object with { valid, iso, display, day, month, year, error }.
 * Avoids any UTC timezone shifts by working strictly with year, month, day components.
 */
function parseDateInput(input) {
    if (!input || typeof input !== 'string') {
        return { valid: false, error: 'Expiry date is required.' };
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return { valid: false, error: 'Expiry date is required.' };
    }

    // Pattern 1: DD/MM/YYYY (or DD-MM-YYYY)
    const dmyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmyMatch) {
        const day = parseInt(dmyMatch[1], 10);
        const month = parseInt(dmyMatch[2], 10);
        const year = parseInt(dmyMatch[3], 10);

        if (!isValidCalendarDate(day, month, year)) {
            return {
                valid: false,
                error: `Invalid calendar date: "${trimmed}". Please check the day and month.`
            };
        }

        const dd = String(day).padStart(2, '0');
        const mm = String(month).padStart(2, '0');
        const yyyy = String(year);

        return {
            valid: true,
            day,
            month,
            year,
            iso: `${yyyy}-${mm}-${dd}`,
            display: `${dd}/${mm}/${yyyy}`
        };
    }

    // Pattern 2: ISO YYYY-MM-DD
    const isoMatch = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (isoMatch) {
        const year = parseInt(isoMatch[1], 10);
        const month = parseInt(isoMatch[2], 10);
        const day = parseInt(isoMatch[3], 10);

        if (!isValidCalendarDate(day, month, year)) {
            return {
                valid: false,
                error: `Invalid calendar date: "${trimmed}". Please check the day and month.`
            };
        }

        const dd = String(day).padStart(2, '0');
        const mm = String(month).padStart(2, '0');
        const yyyy = String(year);

        return {
            valid: true,
            day,
            month,
            year,
            iso: `${yyyy}-${mm}-${dd}`,
            display: `${dd}/${mm}/${yyyy}`
        };
    }

    return {
        valid: false,
        error: 'Date must be entered in DD/MM/YYYY format (e.g. 16/10/2026).'
    };
}

/**
 * Formats any date string (ISO or DD/MM/YYYY) to DD/MM/YYYY format.
 * Returns '-' if empty or invalid.
 */
function formatDateToDisplay(dateStr) {
    if (!dateStr) return '-';
    const parsed = parseDateInput(String(dateStr));
    return parsed.valid ? parsed.display : String(dateStr);
}

/**
 * Normalizes any date string (DD/MM/YYYY or ISO) to ISO YYYY-MM-DD for database storage.
 */
function formatDateToISO(dateStr) {
    if (!dateStr) return null;
    const parsed = parseDateInput(String(dateStr));
    return parsed.valid ? parsed.iso : null;
}

/**
 * Calculates calendar days remaining from reference date to expiry date.
 * Compares purely by calendar date (local midnight to local midnight) to prevent UTC skew.
 * 
 * - diffDays < 0: Expired in the past (e.g. -1 is yesterday)
 * - diffDays === 0: Expires today
 * - diffDays === 1: Expires tomorrow
 * - diffDays === 2: Expires in two days
 * etc.
 */
function getDaysRemaining(expiryInput, referenceDate = new Date()) {
    const parsed = parseDateInput(expiryInput);
    if (!parsed.valid) {
        throw new Error(parsed.error || 'Invalid expiry date');
    }

    // Local calendar date for reference date
    const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    const todayMidnight = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);

    // Local calendar date for expiry date
    const expiryMidnight = new Date(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0);

    const diffMs = expiryMidnight.getTime() - todayMidnight.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculates priority based ONLY on the food's expiry date.
 * 
 * Priority Levels:
 * 1. CRITICAL: Food has already expired or expires today.
 *    - diffDays < 0: isExpired = true, unavailable for redistribution.
 *    - diffDays === 0: expires today, review urgently for safety.
 * 2. HIGH: Food expires within the next 1–2 days (diffDays 1 or 2).
 * 3. MEDIUM: Food expires in 3–5 days (diffDays 3, 4, 5).
 * 4. LOW: Food expires in more than 5 days (diffDays > 5).
 */
function calculateFoodPriority(expiryInput, referenceDate = new Date()) {
    const parsed = parseDateInput(expiryInput);
    if (!parsed.valid) {
        return {
            valid: false,
            error: parsed.error,
            priority: 'NEEDS_REVIEW',
            priorityLevel: 'NEEDS_REVIEW',
            status: 'Needs Review',
            isExpired: false,
            daysRemaining: null,
            badgeLabel: '⚠️ NEEDS_REVIEW',
            badgeClass: 'needs-review',
            warning: parsed.error || 'Missing or invalid expiry date. Needs review before collection.'
        };
    }

    const daysRemaining = getDaysRemaining(parsed.iso, referenceDate);
    const isExpired = daysRemaining < 0;
    const expiresToday = daysRemaining === 0;

    let priority;
    let priorityLevel;
    let badgeClass;
    let badgeLabel;
    let warning;
    let status;

    if (isExpired) {
        priority = 'CRITICAL';
        priorityLevel = 'CRITICAL';
        badgeClass = 'critical';
        const absDays = Math.abs(daysRemaining);
        badgeLabel = '🔴 CRITICAL — Expired';
        warning = `Expired ${absDays === 1 ? 'yesterday' : `${absDays} days ago`}. Expired food must NOT be offered for redistribution.`;
        status = 'Expired';
    } else if (expiresToday) {
        priority = 'CRITICAL';
        priorityLevel = 'CRITICAL';
        badgeClass = 'critical';
        badgeLabel = '🔴 CRITICAL — Expires today';
        warning = 'Food expires today! Must be reviewed urgently and handled according to food-safety requirements.';
        status = 'Available';
    } else if (daysRemaining <= 2) {
        priority = 'HIGH';
        priorityLevel = 'HIGH';
        badgeClass = 'high';
        badgeLabel = `🟠 HIGH — Expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
        warning = 'Urgent: Food expires in 1–2 days. Fast redistribution recommended.';
        status = 'Available';
    } else if (daysRemaining <= 5) {
        priority = 'MEDIUM';
        priorityLevel = 'MEDIUM';
        badgeClass = 'medium';
        badgeLabel = `🟡 MEDIUM — Expires in ${daysRemaining} days`;
        warning = 'Moderate urgency: Food expires in 3–5 days.';
        status = 'Available';
    } else {
        priority = 'LOW';
        priorityLevel = 'NORMAL';
        badgeClass = 'low';
        badgeLabel = `🟢 NORMAL — Expires in ${daysRemaining} days`;
        warning = 'Standard window: Food expires in more than 5 days.';
        status = 'Available';
    }

    return {
        valid: true,
        priority,
        priorityLevel,
        badgeClass,
        badgeLabel,
        daysRemaining,
        isExpired,
        expiresToday,
        warning,
        status,
        isoDate: parsed.iso,
        displayDate: parsed.display
    };
}

/**
 * Sorting comparator for food donations according to urgency requirements:
 * 1. Highest priority first (CRITICAL -> HIGH -> MEDIUM -> LOW).
 * 2. Earliest expiry date first.
 * 3. Stable secondary sort by id or createdAt.
 */
function compareDonationsByUrgency(a, b, referenceDate = new Date()) {
    const priorityWeight = {
        'CRITICAL': 4,
        'Critical': 4,
        'HIGH': 3,
        'High': 3,
        'MEDIUM': 2,
        'Medium': 2,
        'LOW': 1,
        'Low': 1,
        'Expired': 0
    };

    const prioA = priorityWeight[a.priority] !== undefined ? priorityWeight[a.priority] : 1;
    const prioB = priorityWeight[b.priority] !== undefined ? priorityWeight[b.priority] : 1;

    // 1. Highest priority first
    if (prioB !== prioA) {
        return prioB - prioA;
    }

    // 2. Earliest expiry date first
    const isoA = formatDateToISO(a.expiryDate) || '9999-99-99';
    const isoB = formatDateToISO(b.expiryDate) || '9999-99-99';
    if (isoA !== isoB) {
        return isoA.localeCompare(isoB);
    }

    // 3. Stable secondary sort: id ascending
    return Number(a.id || 0) - Number(b.id || 0);
}

/**
 * Calculates dynamic cooked food dates based on current or specified local calendar date.
 * - Prepared Date = current local calendar date (Today)
 * - Expiry Date = current local calendar date + 1 day (Tomorrow)
 * Handles month roll-overs, year roll-overs, and leap years correctly.
 */
function getCookedFoodDates(refDate = new Date()) {
    const ref = refDate instanceof Date ? refDate : new Date(refDate);
    const y = ref.getFullYear();
    const m = ref.getMonth();
    const d = ref.getDate();

    // Today (local midnight)
    const today = new Date(y, m, d);
    const todayDD = String(today.getDate()).padStart(2, '0');
    const todayMM = String(today.getMonth() + 1).padStart(2, '0');
    const todayYYYY = String(today.getFullYear());

    // Tomorrow (today + 1 calendar day)
    const tomorrow = new Date(y, m, d + 1);
    const tomDD = String(tomorrow.getDate()).padStart(2, '0');
    const tomMM = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const tomYYYY = String(tomorrow.getFullYear());

    return {
        preparedDateDisplay: `${todayDD}/${todayMM}/${todayYYYY}`,
        preparedDateISO: `${todayYYYY}-${todayMM}-${todayDD}`,
        expiryDateDisplay: `${tomDD}/${tomMM}/${todayYYYY ? tomYYYY : todayYYYY}`,
        expiryDateISO: `${tomYYYY}-${tomMM}-${tomDD}`
    };
}

// Universal module export (Node.js CommonJS + browser window)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isValidCalendarDate,
        parseDateInput,
        formatDateToDisplay,
        formatDateToISO,
        getDaysRemaining,
        calculateFoodPriority,
        compareDonationsByUrgency,
        getCookedFoodDates
    };
}

if (typeof window !== 'undefined') {
    window.ShareBiteDateUtils = {
        isValidCalendarDate,
        parseDateInput,
        formatDateToDisplay,
        formatDateToISO,
        getDaysRemaining,
        calculateFoodPriority,
        compareDonationsByUrgency,
        getCookedFoodDates
    };
}
