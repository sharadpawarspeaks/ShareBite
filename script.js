/* =========================================================
   SHAREBITE FRONTEND - FULL-STACK CLIENT
   ========================================================= */

/* ================= STATE ================= */

let currentRole = null;
let authMode = "signup";
let uploadedImageBase64 = null;
let imageSource = null; // "camera" | "gallery" | null
let autoSyncInterval = null;

let donations = [];
let notifications = [];
let currentUser = JSON.parse(localStorage.getItem("foodshareCurrentUser") || "null");
let authToken = localStorage.getItem("foodshareToken") || null;


/* ================= API CLIENT ================= */

const API = {
    async request(endpoint, options = {}) {
        const headers = {
            "Content-Type": "application/json",
            ...(options.headers || {})
        };
        const token = localStorage.getItem("foodshareToken");
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        try {
            const res = await fetch(`/api${endpoint}`, {
                ...options,
                headers
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || `HTTP error ${res.status}`);
            }
            return data;
        } catch (err) {
            console.warn(`API call failed for ${endpoint}:`, err.message);
            throw err;
        }
    },

    get(endpoint) {
        return this.request(endpoint, { method: "GET" });
    },

    post(endpoint, body = {}) {
        return this.request(endpoint, {
            method: "POST",
            body: JSON.stringify(body)
        });
    },

    delete(endpoint) {
        return this.request(endpoint, { method: "DELETE" });
    }
};


/* ================= INITIALIZATION ================= */

function setupImageUpload() {
    updateImageActionButtons();
}

document.addEventListener("DOMContentLoaded", async function () {
    initFormDates();
    loadDarkMode();
    setupImageUpload();
    setupDonationForm();
    initHeroSlideshow();

    // Priority input reactive listener (determined SOLELY by expiry date)
    const expEl = document.getElementById("expiryDate");
    if (expEl) {
        expEl.addEventListener("input", updatePriorityPreview);
        expEl.addEventListener("change", updatePriorityPreview);
    }

    // Close modals on Escape key
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
            closeAllModals();
        }
    });

    // Verify session and load initial data from server
    await syncSessionWithBackend();
    await loadInitialData();
    await checkAIStatus();
    await initMapIntegration();

    // Setup live auto-refresh (polls server every 4s when window has focus)
    setupLiveSync();
});

/* ================= HERO SLIDESHOW (2s CONTINUOUS LOOP) ================= */
let heroSlideIndex = 0;
let heroSlideTimer = null;

function initHeroSlideshow() {
    const container = document.getElementById("heroSlideshow");
    if (!container) return;

    const slides = container.querySelectorAll(".slide");
    if (!slides.length) return;

    function renderSlide(index) {
        heroSlideIndex = (index + slides.length) % slides.length;

        // Update slides visibility
        slides.forEach((slide, i) => {
            slide.classList.toggle("active", i === heroSlideIndex);
        });
    }

    function advanceSlide() {
        renderSlide(heroSlideIndex + 1);
    }

    function startTimer() {
        if (heroSlideTimer) clearInterval(heroSlideTimer);
        heroSlideTimer = setInterval(advanceSlide, 2000); // exactly 2 seconds per slide
    }

    window.setSlide = function (index) {
        renderSlide(index);
        startTimer(); // reset interval after manual click
    };

    window.prevSlide = function (e) {
        if (e) e.stopPropagation();
        renderSlide(heroSlideIndex - 1);
        startTimer();
    };

    window.nextSlide = function (e) {
        if (e) e.stopPropagation();
        renderSlide(heroSlideIndex + 1);
        startTimer();
    };

    // Touch swipe support
    let touchStartX = 0;
    container.addEventListener("touchstart", (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    container.addEventListener("touchend", (e) => {
        const touchEndX = e.changedTouches[0].screenX;
        if (touchStartX - touchEndX > 45) {
            window.nextSlide();
        } else if (touchEndX - touchStartX > 45) {
            window.prevSlide();
        }
    }, { passive: true });

    // Initial render and timer
    renderSlide(0);
    startTimer();
}

async function syncSessionWithBackend() {
    if (authToken) {
        try {
            const res = await API.get("/auth/me");
            if (res.user) {
                currentUser = res.user;
                localStorage.setItem("foodshareCurrentUser", JSON.stringify(currentUser));
            }
        } catch {
            // Token expired or invalid
            currentUser = null;
            authToken = null;
            localStorage.removeItem("foodshareCurrentUser");
            localStorage.removeItem("foodshareToken");
        }
    }
    renderNavAuth();
}

async function loadInitialData() {
    await Promise.all([
        loadStatsFromServer(),
        loadDonationsFromServer()
    ]);

    if (currentUser) {
        await loadNotificationsFromServer();
        if (currentUser.role === "donor") {
            await showDonorDashboard();
        } else if (currentUser.role === "ngo") {
            await showNGODashboard();
        }
    }
}

function setupLiveSync() {
    if (autoSyncInterval) clearInterval(autoSyncInterval);

    // Refresh every 4 seconds if tab is active for instant donor-to-NGO reflection
    autoSyncInterval = setInterval(() => {
        if (document.visibilityState === "visible") {
            loadDonationsFromServer(false);
            loadStatsFromServer(false);
            if (currentUser) loadNotificationsFromServer(false);
        }
    }, 4000);

    // Refresh when user returns to tab
    window.addEventListener("focus", () => {
        loadDonationsFromServer(false);
        loadStatsFromServer(false);
        if (currentUser) loadNotificationsFromServer(false);
    });
}


/* ================= SERVER DATA LOADERS ================= */

async function loadStatsFromServer(showLoader = true) {
    try {
        const stats = await API.get("/stats");
        renderHomeStats(stats);
    } catch (err) {
        console.warn("Could not load stats from server:", err);
        renderHomeStats({ totalFood: 0, totalMeals: 0, totalDonations: 0 });
    }
}

async function loadDonationsFromServer(updateViews = true) {
    const recentContainer = document.getElementById("recentFoodContainer");
    if (recentContainer && (!donations || donations.length === 0)) {
        renderLandingLoadingSkeleton();
    }

    try {
        const data = await API.get("/donations");
        donations = data;

        renderLandingRecentFood();

        if (updateViews) {
            loadStatsFromServer(false);
            if (currentUser) {
                if (currentUser.role === "donor") {
                    updateDonorDashboard();
                    renderDonationHistory();
                    updateDonorImpact();
                } else if (currentUser.role === "ngo") {
                    updateNGODashboard();
                    renderNGOAvailable();
                    renderNGOAccepted();
                    updateNGOImpact();
                }
            }
        }
    } catch (err) {
        console.warn("Could not load donations from server:", err);
        renderLandingError();
        if (currentUser?.role === "ngo") {
            renderNGOError();
        }
    }
}

async function loadNotificationsFromServer(updateViews = true) {
    if (!currentUser) return;
    try {
        const data = await API.get("/notifications");
        notifications = data;
        if (updateViews) {
            if (currentUser.role === "donor") {
                renderDonorNotifications();
            } else {
                renderNGONotifications();
            }
        }
    } catch (err) {
        console.warn("Could not load notifications:", err);
    }
}

async function refreshData() {
    showToast("Syncing with live database... 🔄");
    await Promise.all([
        loadDonationsFromServer(),
        loadStatsFromServer(),
        loadNotificationsFromServer()
    ]);
    showToast("Latest available food loaded from database! 🍃");
}


/* ================= NAVIGATION & VIEWS ================= */

function showPage(page) {
    if (page === "home") {
        document.getElementById("homePage").classList.remove("hidden");
        document.getElementById("donorPage").classList.add("hidden");
        document.getElementById("ngoPage").classList.add("hidden");
        loadStatsFromServer();
        loadDonationsFromServer(false);
        renderNavAuth();
        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    }
}

function scrollToSection(id) {
    const homePage = document.getElementById("homePage");
    if (homePage.classList.contains("hidden")) {
        showPage("home");
        setTimeout(() => {
            const section = document.getElementById(id);
            if (section) section.scrollIntoView({ behavior: "smooth" });
        }, 100);
        return;
    }

    const section = document.getElementById(id);
    if (section) {
        section.scrollIntoView({
            behavior: "smooth"
        });
    }
}

function renderNavAuth() {
    const container = document.getElementById("navAuthContainer");
    const mobileContainer = document.getElementById("mobileNavAuthContainer");

    let authHTML = "";
    let mobileAuthHTML = "";

    if (currentUser) {
        const isDonor = currentUser.role === "donor";
        const roleLabel = isDonor ? "Donor" : "NGO";
        const roleIcon = isDonor ? "🍱" : "🏢";
        const actionFn = isDonor ? "showDonorDashboard()" : "showNGODashboard()";

        authHTML = `
            <div class="nav-user-pill">
                <button class="nav-dashboard-btn" onclick="${actionFn}" title="Go to Dashboard">
                    <span>${roleIcon}</span>
                    <strong>${escapeHTML(currentUser.name)}</strong>
                    <small>(${roleLabel})</small>
                </button>
                <button class="nav-logout-btn" onclick="logout()" title="Logout" aria-label="Logout">
                    🚪
                </button>
            </div>
        `;

        mobileAuthHTML = `
            <div style="display:flex;gap:10px;flex-direction:column;margin-top:10px;">
                <button class="btn btn-primary" onclick="${actionFn}; closeLandingMobileNav();" style="width:100%;">
                    ${roleIcon} Open Dashboard (${roleLabel})
                </button>
                <button class="btn btn-secondary" onclick="logout(); closeLandingMobileNav();" style="width:100%;">
                    Logout (${escapeHTML(currentUser.name)})
                </button>
            </div>
        `;
    } else {
        authHTML = `
            <button class="login-nav-btn" onclick="openAuthModal()">
                Sign Up / Login
            </button>
        `;

        mobileAuthHTML = `
            <button class="btn btn-primary" onclick="openAuthModal(); closeLandingMobileNav();" style="width:100%;margin-top:8px;">
                Sign Up / Login
            </button>
        `;
    }

    if (container) container.innerHTML = authHTML;
    if (mobileContainer) mobileContainer.innerHTML = mobileAuthHTML;
}

function toggleLandingMobileNav() {
    const drawer = document.getElementById("landingMobileNav");
    if (drawer) {
        drawer.classList.toggle("hidden");
    }
}

function closeLandingMobileNav() {
    const drawer = document.getElementById("landingMobileNav");
    if (drawer) {
        drawer.classList.add("hidden");
    }
}

function renderHomeStats(stats) {
    const foodElement = document.getElementById("heroFood");
    const mealsElement = document.getElementById("heroMeals");
    const donationsElement = document.getElementById("heroDonations");

    const totalFood = Number(stats?.totalFood || 0);
    const totalMeals = Number(stats?.totalMeals || 0);
    const totalDonations = Number(stats?.totalDonations || 0);

    if (foodElement) foodElement.textContent = `${totalFood.toFixed(1)} kg`;
    if (mealsElement) mealsElement.textContent = totalMeals.toLocaleString();
    if (donationsElement) donationsElement.textContent = totalDonations;
}

function updateHomeStatsLocal() {
    loadStatsFromServer(false);
}

/* ================= LANDING PAGE RECENT FOOD LISTINGS ================= */

function renderLandingLoadingSkeleton() {
    const container = document.getElementById("recentFoodContainer");
    if (!container) return;
    container.innerHTML = `
        <div class="food-skeleton-card">
            <div class="skeleton-shimmer" style="height:150px;width:100%;"></div>
            <div style="padding:16px;">
                <div class="skeleton-shimmer" style="height:20px;width:65%;margin-bottom:8px;border-radius:4px;"></div>
                <div class="skeleton-shimmer" style="height:14px;width:40%;margin-bottom:12px;border-radius:4px;"></div>
                <div class="skeleton-shimmer" style="height:14px;width:80%;margin-bottom:6px;border-radius:4px;"></div>
                <div class="skeleton-shimmer" style="height:14px;width:70%;border-radius:4px;"></div>
            </div>
        </div>
    `.repeat(3);
}

function renderLandingRecentFood() {
    const container = document.getElementById("recentFoodContainer");
    const footer = document.getElementById("recentFoodFooter");
    if (!container) return;

    // Filter only genuine, eligible donations from the database:
    // Must be Available and non-expired
    const eligible = (donations || []).filter(donation => {
        return donation.status === "Available" && !donation.isExpired;
    });

    // Sort: newest submitted donations first
    eligible.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Show 3 to 6 cards
    const recent = eligible.slice(0, 6);

    if (recent.length === 0) {
        if (footer) footer.style.display = "none";
        container.innerHTML = `
            <div class="empty" style="grid-column: 1 / -1; max-width: 620px; margin: 0 auto; width: 100%;">
                <div style="font-size: 42px; margin-bottom: 12px;">🥗</div>
                <h3 style="font-size: 19px; font-weight: 700; color: var(--ink); margin: 0 0 8px 0;">No food donations available right now.</h3>
                <p style="font-size: 14px; color: var(--muted); margin: 0 0 20px 0;">Be the first to share food with your community.</p>
                <button class="btn btn-primary" onclick="openRoleModal('donor')">
                    🍃 Donate Food
                </button>
            </div>
        `;
        return;
    }

    if (footer) footer.style.display = "flex";

    container.innerHTML = recent.map(donation => {
        const priorityBadgeHtml = getPriorityBadgeHTML(donation);
        const daysRemainingHtml = getDaysRemainingText(donation);
        const expiryFormatted = formatDate(donation.expiryDate);

        return `
            <div class="donation-card" onclick="openFoodDetail(${donation.id})">
                <img
                    class="donation-card-image"
                    src="${escapeHTML(donation.image)}"
                    alt="${escapeHTML(donation.foodName)}"
                    loading="lazy"
                >
                <div class="donation-content">
                    <div class="donation-top" style="align-items:flex-start;gap:8px;">
                        <div>
                            <h3 style="margin:0 0 2px 0;">${escapeHTML(donation.foodName)}</h3>
                            <span class="muted">${escapeHTML(donation.foodType)}</span>
                        </div>
                        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                            ${priorityBadgeHtml}
                            <span class="status status-available" style="font-size:10px;padding:2px 7px;">
                                ${escapeHTML(donation.status)}
                            </span>
                        </div>
                    </div>

                    <div class="meta-row">
                        <span>Quantity</span>
                        <strong>${donation.quantity} kg</strong>
                    </div>
                    <div class="meta-row">
                        <span>Food Category</span>
                        <strong>${escapeHTML(donation.foodType)}</strong>
                    </div>
                    <div class="meta-row">
                        <span>Donor</span>
                        <span>👤 <strong>${escapeHTML(donation.donorName || "Community Member")}</strong></span>
                    </div>
                    <div class="meta-row">
                        <span>Pickup Location</span>
                        <span>📍 ${escapeHTML(donation.pickupLocation)}</span>
                    </div>
                    <div class="meta-row">
                        <span>Expiry Date</span>
                        <strong>📅 ${expiryFormatted}</strong>
                    </div>
                    <div class="meta-row">
                        <span>Shelf Life</span>
                        <span style="font-size:11px;font-weight:600;">${daysRemainingHtml}</span>
                    </div>

                    <div style="margin-top:14px;display:flex;gap:8px;">
                        <button
                            class="small-btn small-btn-secondary"
                            style="flex:1;justify-content:center;"
                            onclick="event.stopPropagation(); openFoodDetail(${donation.id})"
                        >
                            👁️ Details
                        </button>
                        <button
                            class="small-btn"
                            style="flex:1;justify-content:center;"
                            onclick="event.stopPropagation(); handleLandingFoodAction(${donation.id})"
                        >
                            🤝 Accept Food
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

function handleLandingFoodAction(id) {
    if (!currentUser) {
        showToast("Please login as an NGO to claim surplus food donations. 🏢");
        openRoleModal("ngo");
        return;
    }
    if (currentUser.role !== "ngo") {
        showToast("Only registered NGOs can accept and collect food donations. 🏢");
        return;
    }
    acceptDonation(id);
}

function navigateToAvailableFood() {
    if (currentUser && currentUser.role === "ngo") {
        showNGODashboard().then(() => {
            ngoTab("available");
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    } else {
        showToast("Access the complete Available Food discovery catalog by signing in as an NGO. 🏢");
        openRoleModal("ngo");
    }
}

function renderLandingError() {
    const container = document.getElementById("recentFoodContainer");
    const footer = document.getElementById("recentFoodFooter");
    if (!container) return;
    if (footer) footer.style.display = "none";
    container.innerHTML = `
        <div class="empty" style="grid-column: 1 / -1; max-width: 620px; margin: 0 auto; width: 100%; border-color: #fca5a5;">
            <div style="font-size: 38px; margin-bottom: 10px;">⚠️</div>
            <strong style="display:block;margin-bottom:6px;font-size:16px;color:#b91c1c;">Unable to connect to database</strong>
            <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">We could not load real food donations from the server. Please check your connection and retry.</p>
            <button class="btn btn-secondary" onclick="loadDonationsFromServer()">
                🔄 Retry Connection
            </button>
        </div>
    `;
}

function renderNGOError() {
    const container = document.getElementById("ngoAvailableContainer");
    if (!container) return;
    container.innerHTML = `
        <div class="empty" style="border-color: #fca5a5;">
            <div style="font-size: 36px; margin-bottom: 10px;">⚠️</div>
            <strong style="display:block;margin-bottom:6px;font-size:16px;color:#b91c1c;">Unable to load food donations</strong>
            <p style="font-size:13px;color:var(--muted);margin-bottom:14px;">Server connection error. Please try again.</p>
            <button class="btn btn-secondary" onclick="loadDonationsFromServer()">
                🔄 Retry
            </button>
        </div>
    `;
}


/* ================= MODALS & POPUPS ================= */

function openAuthModal() {
    openRoleModal(currentRole || "donor");
}

function openRoleModal(role) {
    currentRole = role || "donor";
    document.getElementById("authModal").classList.add("hidden");
    document.getElementById("roleModal").classList.remove("hidden");
    setRoleUI();
}

function setAuthRole(role) {
    currentRole = role;
    setRoleUI();
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.classList.add("hidden");
    }
}

function closeAllModals() {
    document.querySelectorAll(".modal-overlay").forEach(m => m.classList.add("hidden"));
}

function handleModalOverlayClick(event, modalId) {
    if (event.target.id === modalId) {
        closeModal(modalId);
    }
}

function setRoleUI() {
    const label = document.getElementById("authRoleLabel");
    const nameLabel = document.getElementById("nameLabel");
    const donorTab = document.getElementById("roleTabDonor");
    const ngoTab = document.getElementById("roleTabNgo");

    if (currentRole === "ngo") {
        if (label) label.textContent = "NGO / ORGANIZATION";
        if (nameLabel) nameLabel.textContent = "Organization / NGO Name";
        if (donorTab) donorTab.classList.remove("active");
        if (ngoTab) ngoTab.classList.add("active");
    } else {
        if (label) label.textContent = "FOOD DONOR";
        if (nameLabel) nameLabel.textContent = "Your Name / Organization";
        if (donorTab) donorTab.classList.add("active");
        if (ngoTab) ngoTab.classList.remove("active");
    }

    switchAuth(authMode);
}

function switchAuth(mode) {
    authMode = mode;

    const title = document.getElementById("authTitle");
    const subtitle = document.getElementById("authSubtitle");
    const nameField = document.getElementById("nameField");
    const submitBtn = document.getElementById("authSubmitBtn");
    const toggleText = document.getElementById("authToggleText");
    const rememberRow = document.getElementById("rememberRow");

    if (mode === "signup") {
        if (title) title.textContent = currentRole === "ngo" ? "Register Organization" : "Create your account";
        if (subtitle) subtitle.textContent = "Join ShareBite and start making an impact.";
        if (nameField) nameField.style.display = "flex";
        if (submitBtn) submitBtn.textContent = "Sign Up";
        if (toggleText) toggleText.innerHTML = `Already have an account? <span class="span" onclick="switchAuth('login')">Sign In</span>`;
        if (rememberRow) rememberRow.style.display = "none";
    } else {
        if (title) title.textContent = "Welcome back";
        if (subtitle) subtitle.textContent = `Login to continue as ${currentRole === "ngo" ? "NGO / Organization" : "Food Donor"}.`;
        if (nameField) nameField.style.display = "none";
        if (submitBtn) submitBtn.textContent = "Sign In";
        if (toggleText) toggleText.innerHTML = `Don't have an account? <span class="span" onclick="switchAuth('signup')">Sign Up</span>`;
        if (rememberRow) rememberRow.style.display = "flex";
    }
}

/* ================= GOOGLE & APPLE DEVICE ACCOUNTS SYSTEM ================= */

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const DEFAULT_DEVICE_ACCOUNTS = [
    {
        name: "Sharad Pawar",
        email: "pawarsharad1203@gmail.com",
        avatarBg: "#1a73e8",
        isPrimary: true,
        deviceBadge: "Device Default"
    },
    {
        name: "Sharad Pawar (Personal)",
        email: "sharad.pawar@gmail.com",
        avatarBg: "#0f9d58",
        isPrimary: false,
        deviceBadge: "Signed In"
    },
    {
        name: "Sharad Pawar (Community NGO)",
        email: "pawar.ngo@gmail.com",
        avatarBg: "#e37400",
        isPrimary: false,
        deviceBadge: "Saved"
    }
];

function getDeviceAccounts() {
    try {
        const stored = localStorage.getItem("foodshareDeviceAccounts");
        let accounts = stored ? JSON.parse(stored) : [];
        if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
            accounts = [...DEFAULT_DEVICE_ACCOUNTS];
        }

        // If the user currently typed an email in the auth modal, prioritize it dynamically!
        const currentTypedEmail = document.getElementById("authEmail")?.value?.trim();
        if (currentTypedEmail && currentTypedEmail.includes("@")) {
            const existingIdx = accounts.findIndex(a => a.email.toLowerCase() === currentTypedEmail.toLowerCase());
            if (existingIdx !== -1) {
                const [item] = accounts.splice(existingIdx, 1);
                accounts.unshift(item);
            } else {
                const namePart = currentTypedEmail.split("@")[0].replace(/[^a-zA-Z]/g, " ").trim();
                const formattedName = namePart ? namePart.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : "Sharad Pawar";
                accounts.unshift({
                    name: formattedName || "Sharad Pawar",
                    email: currentTypedEmail,
                    avatarBg: "#1a73e8",
                    isPrimary: true,
                    deviceBadge: "Current Input"
                });
            }
        }
        return accounts;
    } catch (e) {
        return DEFAULT_DEVICE_ACCOUNTS;
    }
}

function saveDeviceAccounts(accounts) {
    localStorage.setItem("foodshareDeviceAccounts", JSON.stringify(accounts));
}

function openGoogleAccountChooser() {
    closeModal("roleModal");
    const googleModal = document.getElementById("googleAccountsModal");
    if (!googleModal) return;

    const roleLabel = document.getElementById("googleAccountRoleLabel");
    if (roleLabel) {
        roleLabel.innerHTML = currentRole === "ngo" 
            ? "🏢 Connecting as NGO / Organization" 
            : "👤 Connecting as Food Donor";
    }

    renderGoogleAccountsList();
    googleModal.classList.remove("hidden");
}

function renderGoogleAccountsList() {
    const listEl = document.getElementById("googleAccountsList");
    if (!listEl) return;

    const accounts = getDeviceAccounts();
    listEl.innerHTML = "";

    accounts.forEach((acc) => {
        const row = document.createElement("div");
        row.className = "google-account-row";
        const initial = (acc.name || acc.email || "G").charAt(0).toUpperCase();
        const bg = acc.avatarBg || "#1a73e8";

        row.innerHTML = `
            <div class="google-account-avatar" style="background: ${bg};">${initial}</div>
            <div class="google-account-details">
                <div class="google-account-name-row">
                    <span class="google-account-name">${escapeHtml(acc.name)}</span>
                    ${acc.deviceBadge ? `<span class="google-device-tag">${escapeHtml(acc.deviceBadge)}</span>` : ""}
                </div>
                <div class="google-account-email">${escapeHtml(acc.email)}</div>
            </div>
            ${accounts.length > 1 ? `
                <button type="button" class="google-account-delete" title="Remove account from device" onclick="deleteGoogleAccount('${encodeURIComponent(acc.email)}', event)">
                    ×
                </button>
            ` : ""}
        `;

        row.addEventListener("click", () => {
            selectGoogleAccount(acc);
        });

        listEl.appendChild(row);
    });
}

async function selectGoogleAccount(account) {
    closeModal("googleAccountsModal");
    showToast(`Connecting ${account.name} with Google... ⚡`);

    try {
        const res = await API.post("/auth/social", {
            provider: "Google",
            name: account.name,
            email: account.email,
            role: currentRole || "donor"
        });

        currentUser = res.user;
        authToken = res.token;
        localStorage.setItem("foodshareCurrentUser", JSON.stringify(currentUser));
        localStorage.setItem("foodshareToken", authToken);

        // Put chosen account at front of device accounts
        const accounts = getDeviceAccounts();
        const existingIdx = accounts.findIndex(a => a.email.toLowerCase() === account.email.toLowerCase());
        if (existingIdx !== -1) {
            const [item] = accounts.splice(existingIdx, 1);
            item.deviceBadge = "Active Account";
            accounts.unshift(item);
            saveDeviceAccounts(accounts);
        }

        renderNavAuth();
        await loadDonationsFromServer();
        await loadNotificationsFromServer();

        showToast(`Welcome, ${currentUser.name}! Signed in via Google 🚀`);

        if (currentUser.role === "donor") {
            showDonorDashboard();
        } else {
            showNGODashboard();
        }
    } catch (err) {
        showToast("Google sign in failed: " + err.message);
    }
}

function toggleGoogleAddForm() {
    const form = document.getElementById("googleAddForm");
    if (!form) return;
    if (form.style.display === "none") {
        form.style.display = "flex";
        document.getElementById("googleNewName")?.focus();
    } else {
        form.style.display = "none";
    }
}

async function handleGoogleAddAccount(e) {
    e.preventDefault();
    const nameInput = document.getElementById("googleNewName");
    const emailInput = document.getElementById("googleNewEmail");
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();

    if (!email || !email.includes("@")) {
        showToast("Please enter a valid Google email.");
        return;
    }

    const accounts = getDeviceAccounts();
    const colors = ["#1a73e8", "#0f9d58", "#ea4335", "#fbbc04", "#8430ce"];
    const avatarBg = colors[Math.floor(Math.random() * colors.length)];

    const newAcc = {
        name: name || email.split("@")[0],
        email: email,
        avatarBg: avatarBg,
        isPrimary: true,
        deviceBadge: "Saved"
    };

    const filtered = accounts.filter(a => a.email.toLowerCase() !== email.toLowerCase());
    filtered.unshift(newAcc);
    saveDeviceAccounts(filtered);

    nameInput.value = "";
    emailInput.value = "";
    toggleGoogleAddForm();

    await selectGoogleAccount(newAcc);
}

function deleteGoogleAccount(encodedEmail, e) {
    e.stopPropagation();
    const email = decodeURIComponent(encodedEmail);
    let accounts = getDeviceAccounts();
    accounts = accounts.filter(a => a.email.toLowerCase() !== email.toLowerCase());
    saveDeviceAccounts(accounts);
    renderGoogleAccountsList();
    showToast(`Removed ${email} from device.`);
}

/* ================= APPLE ACCOUNTS SYSTEM ================= */

let currentAppleEmailMode = "share";

function openAppleAccountChooser() {
    closeModal("roleModal");
    const appleModal = document.getElementById("appleAccountsModal");
    if (!appleModal) return;

    const accounts = getDeviceAccounts();
    const primary = accounts[0] || { name: "Sharad Pawar", email: "pawarsharad1203@gmail.com" };

    const nameEl = document.getElementById("appleProfileName");
    const emailEl = document.getElementById("appleProfileEmail");
    const avatarEl = document.getElementById("appleAvatarInitial");
    const shareDesc = document.getElementById("appleShareEmailDesc");
    const relayDesc = document.getElementById("appleRelayEmailDesc");

    if (nameEl) nameEl.textContent = primary.name;
    if (emailEl) emailEl.textContent = primary.email.replace(/@.+/, "@icloud.com");
    if (avatarEl) avatarEl.textContent = (primary.name || "S").charAt(0).toUpperCase();
    if (shareDesc) shareDesc.textContent = primary.email;
    if (relayDesc) {
        const prefix = primary.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3) || "sp";
        relayDesc.textContent = `${prefix}.relay91@privaterelay.appleid.com (Relays to ${primary.email})`;
    }

    appleModal.classList.remove("hidden");
}

function toggleAppleEmailMode() {
    const radios = document.getElementsByName("appleEmailOpt");
    for (const r of radios) {
        if (r.checked) {
            currentAppleEmailMode = r.value;
            break;
        }
    }
}

function toggleAppleDifferentAccount() {
    const row = document.getElementById("appleCustomEmailRow");
    if (!row) return;
    if (row.style.display === "none") {
        row.style.display = "flex";
        document.getElementById("appleCustomEmail")?.focus();
    } else {
        row.style.display = "none";
    }
}

async function confirmAppleSignIn() {
    const btn = document.getElementById("appleContinueBtn");
    const customEmailInput = document.getElementById("appleCustomEmail");
    const accounts = getDeviceAccounts();
    const primary = accounts[0] || { name: "Sharad Pawar", email: "pawarsharad1203@gmail.com" };

    let finalEmail = primary.email;
    let finalName = primary.name;

    if (customEmailInput && customEmailInput.value.trim()) {
        finalEmail = customEmailInput.value.trim();
        finalName = finalEmail.split("@")[0];
    } else if (currentAppleEmailMode === "hide") {
        const prefix = primary.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 3) || "sp";
        finalEmail = `${prefix}.relay91@privaterelay.appleid.com`;
    }

    if (btn) {
        btn.innerHTML = `<span>Verifying Touch ID / Passcode...</span> <span>⏳</span>`;
        btn.disabled = true;
    }

    setTimeout(async () => {
        closeModal("appleAccountsModal");
        if (btn) {
            btn.innerHTML = `<span>Continue with Apple ID</span> <span id="appleBiometricIcon"></span>`;
            btn.disabled = false;
        }

        try {
            const res = await API.post("/auth/social", {
                provider: "Apple",
                name: finalName,
                email: finalEmail,
                role: currentRole || "donor"
            });

            currentUser = res.user;
            authToken = res.token;
            localStorage.setItem("foodshareCurrentUser", JSON.stringify(currentUser));
            localStorage.setItem("foodshareToken", authToken);

            renderNavAuth();
            await loadDonationsFromServer();
            await loadNotificationsFromServer();

            showToast(`Apple ID Verified! Welcome, ${currentUser.name} `);

            if (currentUser.role === "donor") {
                showDonorDashboard();
            } else {
                showNGODashboard();
            }
        } catch (err) {
            showToast("Apple sign in failed: " + err.message);
        }
    }, 700);
}

function socialLogin(provider) {
    if (provider === "Google") {
        openGoogleAccountChooser();
    } else if (provider === "Apple") {
        openAppleAccountChooser();
    } else {
        showToast(`Connecting with ${provider}... ⚡`);
        demoLogin(currentRole);
    }
}


/* ================= FORGOT PASSWORD & EMAIL OTP FLOW ================= */

const fpState = {
    email: '',
    resetToken: '',
    expiresAt: 0,
    expiryInterval: null,
    cooldownInterval: null,
    cooldownSeconds: 0
};

function openForgotPasswordModal(prefillEmail = '') {
    closeModal('roleModal');
    const modal = document.getElementById('forgotPasswordModal');
    if (!modal) return;

    // Reset state and banners
    showFpBanner('', '');
    const emailInput = document.getElementById('fpEmailInput');
    const email = prefillEmail || document.getElementById('authEmail')?.value?.trim() || '';
    if (emailInput) {
        emailInput.value = email;
    }

    switchFpStep('email');
    modal.classList.remove('hidden');
    if (emailInput && !email) {
        setTimeout(() => emailInput.focus(), 150);
    }
}

function forgotPassword() {
    const currentTyped = document.getElementById('authEmail')?.value?.trim() || '';
    openForgotPasswordModal(currentTyped);
}

function returnToLoginModal() {
    closeModal('forgotPasswordModal');
    stopFpTimers();

    // If reset succeeded, prefill the email in login modal
    if (fpState.email) {
        const loginEmail = document.getElementById('authEmail');
        if (loginEmail) loginEmail.value = fpState.email;
    }

    openRoleModal(currentRole || 'donor');
    switchAuth('login');
}

function switchFpStep(step) {
    showFpBanner('', '');

    const stepEmail = document.getElementById('fpStepEmail');
    const stepOtp = document.getElementById('fpStepOtp');
    const stepReset = document.getElementById('fpStepReset');
    const stepSuccess = document.getElementById('fpStepSuccess');

    if (stepEmail) stepEmail.classList.toggle('hidden', step !== 'email');
    if (stepOtp) stepOtp.classList.toggle('hidden', step !== 'otp');
    if (stepReset) stepReset.classList.toggle('hidden', step !== 'reset');
    if (stepSuccess) stepSuccess.classList.toggle('hidden', step !== 'success');

    if (step === 'email') {
        stopFpTimers();
        setTimeout(() => document.getElementById('fpEmailInput')?.focus(), 100);
    } else if (step === 'otp') {
        const otpInput = document.getElementById('fpOtpInput');
        if (otpInput) {
            otpInput.value = '';
            setTimeout(() => otpInput.focus(), 100);
        }
    } else if (step === 'reset') {
        stopFpTimers();
        const newPass = document.getElementById('fpNewPassword');
        const confirmPass = document.getElementById('fpConfirmPassword');
        if (newPass) newPass.value = '';
        if (confirmPass) confirmPass.value = '';
        setTimeout(() => newPass?.focus(), 100);
    }
}

function showFpBanner(message, type = 'error') {
    const banner = document.getElementById('fpStatusBanner');
    if (!banner) return;
    if (!message) {
        banner.style.display = 'none';
        banner.className = 'fp-status-banner';
        banner.textContent = '';
        return;
    }
    banner.textContent = message;
    banner.className = `fp-status-banner ${type}`;
    banner.style.display = 'block';
}

function stopFpTimers() {
    if (fpState.expiryInterval) {
        clearInterval(fpState.expiryInterval);
        fpState.expiryInterval = null;
    }
    if (fpState.cooldownInterval) {
        clearInterval(fpState.cooldownInterval);
        fpState.cooldownInterval = null;
    }
}

function startOtpCountdown(durationSeconds = 300) {
    if (fpState.expiryInterval) clearInterval(fpState.expiryInterval);
    fpState.expiresAt = Date.now() + durationSeconds * 1000;

    const display = document.getElementById('fpTimerDisplay');
    const badge = document.getElementById('fpTimerBadge');

    function update() {
        const remainingMs = fpState.expiresAt - Date.now();
        if (remainingMs <= 0) {
            if (display) display.textContent = '00:00 (Expired)';
            if (badge) badge.style.color = '#ef4444';
            clearInterval(fpState.expiryInterval);
            fpState.expiryInterval = null;
            showFpBanner('Your verification code has expired. Please click "Resend Code".', 'error');
            return;
        }

        const totalSec = Math.floor(remainingMs / 1000);
        const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const secs = String(totalSec % 60).padStart(2, '0');
        if (display) display.textContent = `${mins}:${secs}`;
    }

    update();
    fpState.expiryInterval = setInterval(update, 1000);
}

function startResendCooldown(seconds = 60) {
    if (fpState.cooldownInterval) clearInterval(fpState.cooldownInterval);
    fpState.cooldownSeconds = seconds;

    const resendBtn = document.getElementById('fpResendOtpBtn');
    if (!resendBtn) return;
    resendBtn.disabled = true;

    function update() {
        if (fpState.cooldownSeconds <= 0) {
            resendBtn.disabled = false;
            resendBtn.textContent = 'Resend Code';
            clearInterval(fpState.cooldownInterval);
            fpState.cooldownInterval = null;
            return;
        }
        resendBtn.textContent = `Resend Code (${fpState.cooldownSeconds}s)`;
        fpState.cooldownSeconds--;
    }

    update();
    fpState.cooldownInterval = setInterval(update, 1000);
}

async function submitForgotPasswordEmail() {
    const emailInput = document.getElementById('fpEmailInput');
    const sendBtn = document.getElementById('fpSendOtpBtn');
    const email = emailInput?.value?.trim() || '';

    if (!email || !email.includes('@')) {
        showFpBanner('Please enter a valid email address.', 'error');
        emailInput?.focus();
        return;
    }

    showFpBanner('', '');
    const originalText = sendBtn.innerHTML;
    sendBtn.disabled = true;
    sendBtn.innerHTML = 'Sending Code... ⏳';

    try {
        const res = await API.post('/auth/forgot-password', { email });
        fpState.email = email;

        const targetDisplay = document.getElementById('fpTargetEmailDisplay');
        if (targetDisplay) targetDisplay.textContent = email;

        switchFpStep('otp');
        showFpBanner(res.message || 'Verification code sent! Please check your email.', 'success');
        startOtpCountdown(res.expiresInSeconds || 300);
        startResendCooldown(res.cooldownSeconds || 60);
        showToast('6-digit verification code sent! 📧');
    } catch (err) {
        showFpBanner(err.message || 'Unable to request code. Please try again.', 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = originalText;
    }
}

async function submitVerifyOtp() {
    const otpInput = document.getElementById('fpOtpInput');
    const verifyBtn = document.getElementById('fpVerifyOtpBtn');
    const otp = otpInput?.value?.trim() || '';

    if (!otp || !/^\d{6}$/.test(otp)) {
        showFpBanner('Please enter the full 6-digit verification code.', 'error');
        otpInput?.focus();
        return;
    }

    showFpBanner('', '');
    const originalText = verifyBtn.innerHTML;
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = 'Verifying... ⏳';

    try {
        const res = await API.post('/auth/verify-otp', {
            email: fpState.email,
            otp
        });

        fpState.resetToken = res.resetToken;
        stopFpTimers();
        switchFpStep('reset');
        showToast('Code verified successfully! 🛡️');
    } catch (err) {
        showFpBanner(err.message || 'Invalid or expired verification code.', 'error');
        otpInput?.focus();
    } finally {
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = originalText;
    }
}

async function resendOtpCode() {
    const resendBtn = document.getElementById('fpResendOtpBtn');
    if (!fpState.email) {
        switchFpStep('email');
        return;
    }

    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending...';

    try {
        const res = await API.post('/auth/forgot-password', { email: fpState.email });
        showFpBanner('A fresh verification code has been dispatched to your email.', 'success');
        const otpInput = document.getElementById('fpOtpInput');
        if (otpInput) {
            otpInput.value = '';
            otpInput.focus();
        }
        startOtpCountdown(res.expiresInSeconds || 300);
        startResendCooldown(res.cooldownSeconds || 60);
        showToast('New verification code sent! 📧');
    } catch (err) {
        showFpBanner(err.message || 'Could not resend code. Please try again.', 'error');
        startResendCooldown(30);
    }
}

async function submitPasswordReset() {
    const newPassInput = document.getElementById('fpNewPassword');
    const confirmPassInput = document.getElementById('fpConfirmPassword');
    const submitBtn = document.getElementById('fpResetSubmitBtn');

    const newPassword = newPassInput?.value || '';
    const confirmPassword = confirmPassInput?.value || '';

    if (!newPassword || !confirmPassword) {
        showFpBanner('Please enter and confirm your new password.', 'error');
        return;
    }

    if (newPassword.length < 8) {
        showFpBanner('Password must be at least 8 characters long.', 'error');
        newPassInput?.focus();
        return;
    }

    if (newPassword !== confirmPassword) {
        showFpBanner('Passwords do not match. Please verify.', 'error');
        confirmPassInput?.focus();
        return;
    }

    showFpBanner('', '');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Updating Password... ⏳';

    try {
        await API.post('/auth/reset-password', {
            email: fpState.email,
            resetToken: fpState.resetToken,
            newPassword,
            confirmPassword
        });

        switchFpStep('success');
        showToast('Password reset successfully! 🎉');
    } catch (err) {
        showFpBanner(err.message || 'Failed to reset password. Please start over.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

// Auto-advance and digit-only filter on OTP input field
document.addEventListener('DOMContentLoaded', () => {
    const otpInput = document.getElementById('fpOtpInput');
    if (otpInput) {
        otpInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
            if (e.target.value.length === 6) {
                // Auto trigger verification when 6 digits entered
                submitVerifyOtp();
            }
        });
        otpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitVerifyOtp();
            }
        });
    }

    const emailInput = document.getElementById('fpEmailInput');
    if (emailInput) {
        emailInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitForgotPasswordEmail();
            }
        });
    }

    const confirmPass = document.getElementById('fpConfirmPassword');
    if (confirmPass) {
        confirmPass.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitPasswordReset();
            }
        });
    }
});


/* ================= 1-CLICK DEMO LOGIN ================= */

async function demoLogin(role) {
    closeAllModals();
    showToast(`Logging in as Demo ${role === "donor" ? "Donor" : "NGO (Hope Shelter)"}... ⚡`);

    try {
        const res = await API.post("/auth/demo", { role });
        currentUser = res.user;
        authToken = res.token;
        localStorage.setItem("foodshareCurrentUser", JSON.stringify(currentUser));
        localStorage.setItem("foodshareToken", authToken);

        renderNavAuth();
        await loadDonationsFromServer();
        await loadNotificationsFromServer();

        showToast(`Logged in as ${currentUser.name}! 👋`);

        if (currentUser.role === "donor") {
            showDonorDashboard();
        } else {
            showNGODashboard();
        }
    } catch (err) {
        showToast("Demo login failed: " + err.message);
    }
}


/* ================= AUTHENTICATION FORM ================= */

document.getElementById("authForm").addEventListener("submit", async function (event) {
    event.preventDefault();

    const name = document.getElementById("authName").value.trim();
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value.trim();

    if (!email || !password) {
        showToast("Please enter email and password.");
        return;
    }

    try {
        if (authMode === "signup") {
            if (!name) {
                showToast("Please enter your name.");
                return;
            }

            const res = await API.post("/auth/signup", {
                name,
                email,
                password,
                role: currentRole
            });

            currentUser = res.user;
            authToken = res.token;
            localStorage.setItem("foodshareCurrentUser", JSON.stringify(currentUser));
            localStorage.setItem("foodshareToken", authToken);

            closeModal("roleModal");
            renderNavAuth();
            showToast(`Account created successfully! Welcome ${name} 🎉`);
        } else {
            const res = await API.post("/auth/login", {
                email,
                password,
                role: currentRole
            });

            currentUser = res.user;
            authToken = res.token;
            localStorage.setItem("foodshareCurrentUser", JSON.stringify(currentUser));
            localStorage.setItem("foodshareToken", authToken);

            closeModal("roleModal");
            renderNavAuth();
            showToast(`Welcome back, ${currentUser.name}! 👋`);
        }

        await loadDonationsFromServer();
        await loadNotificationsFromServer();

        if (currentRole === "donor") {
            showDonorDashboard();
        } else {
            showNGODashboard();
        }
    } catch (err) {
        showToast(err.message || "Authentication error.");
    }
});


/* ================= DONOR DASHBOARD ================= */

async function showDonorDashboard() {
    document.getElementById("homePage").classList.add("hidden");
    document.getElementById("ngoPage").classList.add("hidden");
    document.getElementById("donorPage").classList.remove("hidden");

    const name = currentUser?.name || "Donor";

    const nameEl = document.getElementById("donorName");
    const topNameEl = document.getElementById("donorTopName");
    const welcomeEl = document.getElementById("donorWelcome");

    if (nameEl) nameEl.textContent = name;
    if (topNameEl) topNameEl.textContent = name;
    if (welcomeEl) welcomeEl.textContent = name;

    renderNavAuth();
    await loadDonationsFromServer(false);
    await loadStatsFromServer(false);

    donorTab("overview");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

async function donorTab(tab, button = null) {
    closeMobileSidebars();

    const tabs = document.querySelectorAll("#donorPage .dashboard-tab");
    tabs.forEach(element => element.classList.add("hidden"));

    const selected = document.getElementById(`donor-${tab}`);
    if (selected) {
        selected.classList.remove("hidden");
    }

    const links = document.querySelectorAll("#donorPage .side-link");
    links.forEach(link => link.classList.remove("active"));

    if (button) {
        button.classList.add("active");
    } else {
        const tabMap = {
            overview: 0,
            donate: 1,
            history: 2,
            impact: 3,
            notifications: 4,
            settings: 5
        };
        if (links[tabMap[tab]]) {
            links[tabMap[tab]].classList.add("active");
        }
    }

    if (tab === "overview" || tab === "history" || tab === "impact") {
        await loadDonationsFromServer(false);
    }

    if (tab === "donate" && donorMap) {
        setTimeout(() => {
            donorMap.invalidateSize();
        }, 150);
    }

    if (tab === "overview") {
        updateDonorDashboard();
    } else if (tab === "donate") {
        initFormDates();
    } else if (tab === "history") {
        renderDonationHistory();
    } else if (tab === "impact") {
        updateDonorImpact();
    } else if (tab === "notifications") {
        renderDonorNotifications();
    }
}

function updateDonorDashboard() {
    if (!currentUser) return;

    const userDonations = donations.filter(
        donation => donation.donorEmail.toLowerCase() === currentUser.email.toLowerCase()
    );

    const totalFood = userDonations.reduce(
        (sum, donation) => sum + Number(donation.quantity || 0),
        0
    );

    const completed = userDonations.filter(
        donation => donation.status === "Completed"
    ).length;

    const meals = Math.round(totalFood * 4);

    const foodEl = document.getElementById("donorTotalFood");
    const donEl = document.getElementById("donorTotalDonations");
    const mealsEl = document.getElementById("donorTotalMeals");
    const compEl = document.getElementById("donorCompleted");

    if (foodEl) foodEl.textContent = `${totalFood.toFixed(1)} kg`;
    if (donEl) donEl.textContent = userDonations.length;
    if (mealsEl) mealsEl.textContent = meals.toLocaleString();
    if (compEl) compEl.textContent = completed;

    renderRecentDonations();
}


/* ================= DONATION FORM ================= */

/* ================= DONATION FORM ================= */

function getTodayFormattedDDMMYYYY() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function openDatePicker(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field || field.readOnly || field.disabled) return;

    const nativePicker = document.getElementById(fieldId + "Native");
    if (!nativePicker) return;

    // Convert current value (if valid) to YYYY-MM-DD so the picker opens to that date
    if (field.value && window.ShareBiteDateUtils) {
        const parsed = window.ShareBiteDateUtils.parseDateInput(field.value);
        if (parsed.valid && parsed.iso) {
            nativePicker.value = parsed.iso;
        }
    } else {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        nativePicker.value = `${y}-${m}-${d}`;
    }

    if (typeof nativePicker.showPicker === "function") {
        try {
            nativePicker.showPicker();
        } catch {
            nativePicker.focus();
        }
    } else {
        nativePicker.focus();
    }
}

function handleDateInputClick(inputEl) {
    if (!inputEl || inputEl.readOnly || inputEl.disabled) return;
    openDatePicker(inputEl.id);
}

function syncNativeDateToField(fieldId, isoVal) {
    if (!isoVal) return;
    const field = document.getElementById(fieldId);
    if (!field || field.readOnly || field.disabled) return;

    if (window.ShareBiteDateUtils) {
        const display = window.ShareBiteDateUtils.formatDateToDisplay(isoVal);
        field.value = display;
    } else {
        const parts = isoVal.split("-");
        if (parts.length === 3) {
            field.value = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
    }

    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
}

function handleFoodTypeChange() {
    const foodTypeEl = document.getElementById("foodType");
    const prepInput = document.getElementById("preparedDate");
    const expInput = document.getElementById("expiryDate");
    const prepBtn = document.getElementById("preparedDateCalBtn");
    const expBtn = document.getElementById("expiryDateCalBtn");
    const prepHelp = document.getElementById("preparedDateHelp");
    const expHelp = document.getElementById("expiryDateHelp");

    if (!foodTypeEl || !prepInput || !expInput) return;

    const selectedType = foodTypeEl.value;

    if (selectedType === "Cooked Food") {
        const dates = window.ShareBiteDateUtils && typeof window.ShareBiteDateUtils.getCookedFoodDates === "function"
            ? window.ShareBiteDateUtils.getCookedFoodDates()
            : (() => {
                const now = new Date();
                const tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                const pDD = String(now.getDate()).padStart(2, "0");
                const pMM = String(now.getMonth() + 1).padStart(2, "0");
                const eDD = String(tom.getDate()).padStart(2, "0");
                const eMM = String(tom.getMonth() + 1).padStart(2, "0");
                return {
                    preparedDateDisplay: `${pDD}/${pMM}/${now.getFullYear()}`,
                    expiryDateDisplay: `${eDD}/${eMM}/${tom.getFullYear()}`
                };
            })();

        prepInput.value = dates.preparedDateDisplay;
        prepInput.readOnly = true;
        prepInput.classList.add("date-readonly");

        expInput.value = dates.expiryDateDisplay;
        expInput.readOnly = true;
        expInput.classList.add("date-readonly");

        if (prepBtn) prepBtn.disabled = true;
        if (expBtn) expBtn.disabled = true;

        if (prepHelp) prepHelp.textContent = "Auto-set: Prepared today for Cooked Food (non-editable)";
        if (expHelp) expHelp.textContent = "Auto-set: Cooked food expires in 1 day / tomorrow (non-editable)";

        expInput.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
        prepInput.readOnly = false;
        prepInput.classList.remove("date-readonly");

        expInput.readOnly = false;
        expInput.classList.remove("date-readonly");

        if (prepBtn) prepBtn.disabled = false;
        if (expBtn) expBtn.disabled = false;

        if (prepHelp) prepHelp.textContent = "Format: DD/MM/YYYY (e.g. 16/10/2026)";
        if (expHelp) expHelp.textContent = "Format: DD/MM/YYYY (e.g. 16/10/2026)";

        expInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
}

function initFormDates() {
    const todayFormatted = getTodayFormattedDDMMYYYY();
    const preparedInput = document.getElementById("preparedDate");
    const expiryInput = document.getElementById("expiryDate");

    if (preparedInput && !preparedInput.value) {
        preparedInput.value = todayFormatted;
    }
    if (expiryInput && !expiryInput.value) {
        expiryInput.value = "";
    }

    handleFoodTypeChange();
}

function attachDateInputMask(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener("input", function () {
        if (this.readOnly) return;
        let val = this.value.replace(/[^\d]/g, "");
        if (val.length > 8) val = val.substring(0, 8);
        if (val.length >= 5) {
            this.value = `${val.substring(0, 2)}/${val.substring(2, 4)}/${val.substring(4)}`;
        } else if (val.length >= 3) {
            this.value = `${val.substring(0, 2)}/${val.substring(2)}`;
        } else {
            this.value = val;
        }
        if (this.id === "expiryDate") {
            updatePriorityPreview();
        }
    });
}

function resetDonationForm() {
    const form = document.getElementById("donationForm");
    if (form) form.reset();
    removeImage();

    const latInput = document.getElementById("pickupLatitude");
    const lngInput = document.getElementById("pickupLongitude");
    if (latInput) latInput.value = "";
    if (lngInput) lngInput.value = "";
    if (typeof resetMapPicker === "function") resetMapPicker();

    const badge = document.getElementById("priorityBadge");
    const text = document.getElementById("priorityText");
    if (badge) {
        badge.className = "priority-badge";
        badge.textContent = "Not analyzed";
    }
    if (text) {
        text.textContent = "Enter expiry date (DD/MM/YYYY) to calculate priority.";
    }

    initFormDates();
    handleFoodTypeChange();
}

function setupDonationForm() {
    const form = document.getElementById("donationForm");
    if (!form) return;

    // Completely prevent browser native form submission and reload
    form.onsubmit = function (e) {
        if (e) e.preventDefault();
        return false;
    };

    const prepInput = document.getElementById("preparedDate");
    const expInput = document.getElementById("expiryDate");
    if (prepInput) attachDateInputMask(prepInput);
    if (expInput) attachDateInputMask(expInput);

    const foodTypeEl = document.getElementById("foodType");
    if (foodTypeEl) {
        foodTypeEl.addEventListener("change", handleFoodTypeChange);
    }
    handleFoodTypeChange();

    form.addEventListener("submit", async function (event) {
        if (event) event.preventDefault();

        if (!currentUser) {
            try {
                currentUser = JSON.parse(localStorage.getItem("foodshareCurrentUser") || "null");
            } catch {}
        }
        if (!authToken) {
            authToken = localStorage.getItem("foodshareToken") || null;
        }

        if (!currentUser) {
            showToast("Please login first.");
            return;
        }

        const foodName = document.getElementById("foodName").value.trim();
        const foodType = document.getElementById("foodType").value;
        const quantity = Number(document.getElementById("foodQuantity").value);
        const preparedDate = document.getElementById("preparedDate").value.trim();
        const expiryDate = document.getElementById("expiryDate").value.trim();
        const pickupLocation = document.getElementById("pickupLocation").value.trim();
        const description = document.getElementById("foodDescription").value.trim();

        const imgErrorEl = document.getElementById("foodImageError");
        if (imgErrorEl) {
            imgErrorEl.classList.add("hidden");
            imgErrorEl.textContent = "";
        }

        // Mandatory food image validation (compulsory)
        if (!uploadedImageBase64) {
            showToast("Please upload a photo of the food before listing it.");
            if (imgErrorEl) {
                imgErrorEl.textContent = "Please upload a photo of the food before listing it.";
                imgErrorEl.classList.remove("hidden");
            }
            const section = document.getElementById("foodImageSection");
            if (section) {
                section.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            return;
        }

        if (!foodName || !foodType || !quantity || !preparedDate || !expiryDate || !pickupLocation) {
            showToast("Please complete all required fields.");
            return;
        }

        if (quantity <= 0 || isNaN(quantity)) {
            showToast("Please enter a valid positive quantity.");
            return;
        }

        // Validate Prepared Date format
        const parsedPrepared = window.ShareBiteDateUtils
            ? window.ShareBiteDateUtils.parseDateInput(preparedDate)
            : { valid: Boolean(preparedDate) };

        if (!parsedPrepared.valid) {
            showToast(parsedPrepared.error || "Please enter a valid prepared date in DD/MM/YYYY format.");
            document.getElementById("preparedDate")?.focus();
            return;
        }

        // Validate Expiry Date format
        const parsedExpiry = window.ShareBiteDateUtils
            ? window.ShareBiteDateUtils.parseDateInput(expiryDate)
            : { valid: Boolean(expiryDate) };

        if (!parsedExpiry.valid) {
            showToast(parsedExpiry.error || "Please enter a valid calendar expiry date in DD/MM/YYYY format.");
            document.getElementById("expiryDate")?.focus();
            return;
        }

        if (parsedPrepared.iso && parsedExpiry.iso && parsedExpiry.iso < parsedPrepared.iso) {
            showToast("Expiry date cannot be before prepared date.");
            return;
        }

        const latitudeVal = document.getElementById("pickupLatitude")?.value;
        const longitudeVal = document.getElementById("pickupLongitude")?.value;

        const payload = {
            foodName,
            foodType,
            quantity,
            preparedDate: parsedPrepared.iso || preparedDate,
            expiryDate: parsedExpiry.iso || expiryDate,
            pickupLocation,
            latitude: latitudeVal ? Number(latitudeVal) : null,
            longitude: longitudeVal ? Number(longitudeVal) : null,
            description,
            image: uploadedImageBase64
        };

        try {
            showToast("Submitting food donation to database... ⏳");
            const newDonation = await API.post("/donations", payload);

            showToast("Food donation posted to database! 🎉 Visible to all NGOs immediately.");
            resetDonationForm();

            // Refresh live list from database
            await loadDonationsFromServer();
            await loadStatsFromServer();
            await loadNotificationsFromServer();

            setTimeout(function () {
                donorTab("history");
            }, 500);
        } catch (err) {
            showToast("Error submitting donation: " + err.message);
        }
    });
}


/* ================= PRIORITY CALCULATION (EXPIRY DATE ONLY) ================= */

function calculatePriority(expiryDate) {
    if (!expiryDate) return "Low";
    if (window.ShareBiteDateUtils) {
        const info = window.ShareBiteDateUtils.calculateFoodPriority(expiryDate);
        return info.priority;
    }
    return "Medium";
}

function updatePriorityPreview() {
    const expiryRaw = document.getElementById("expiryDate")?.value?.trim();
    const badge = document.getElementById("priorityBadge");
    const text = document.getElementById("priorityText");

    if (!badge || !text) return;

    if (!expiryRaw) {
        badge.className = "priority-badge";
        badge.textContent = "Not analyzed";
        text.textContent = "Enter expiry date (DD/MM/YYYY) to calculate priority.";
        return;
    }

    if (!window.ShareBiteDateUtils) {
        badge.className = "priority-badge";
        badge.textContent = "PENDING";
        text.textContent = "Calculating priority...";
        return;
    }

    const parsed = window.ShareBiteDateUtils.parseDateInput(expiryRaw);
    if (!parsed.valid) {
        badge.className = "priority-badge critical";
        badge.textContent = "INVALID DATE";
        text.textContent = parsed.error || "Please enter a valid calendar date in DD/MM/YYYY format (e.g. 16/10/2026).";
        return;
    }

    const priorityInfo = window.ShareBiteDateUtils.calculateFoodPriority(parsed.iso);
    badge.className = `priority-badge ${priorityInfo.badgeClass || 'low'}`;
    badge.textContent = priorityInfo.badgeLabel;
    text.textContent = priorityInfo.warning;
}

function getPriorityBadgeHTML(donation) {
    const p = (donation.priority || "NORMAL").toUpperCase();
    if (donation.isExpired || donation.status === "Expired") {
        return `<span class="priority-badge critical" title="Food has expired. Expired food must not be offered for redistribution.">🔴 CRITICAL</span>`;
    }
    if (p === "CRITICAL") {
        return `<span class="priority-badge critical" title="Less than 6 hours remaining">🔴 CRITICAL</span>`;
    }
    if (p === "HIGH") {
        return `<span class="priority-badge high" title="6 to 24 hours remaining">🟠 HIGH</span>`;
    }
    if (p === "MEDIUM") {
        return `<span class="priority-badge medium" title="1 to 3 days remaining">🟡 MEDIUM</span>`;
    }
    if (p === "NEEDS_REVIEW") {
        return `<span class="priority-badge needs-review" title="Missing or invalid expiry information">🟣 NEEDS REVIEW</span>`;
    }
    return `<span class="priority-badge low" title="More than 3 days remaining">🟢 NORMAL</span>`;
}

function getDaysRemainingText(donation) {
    if (donation.isExpired || donation.status === "Expired") {
        const days = Math.abs(donation.daysRemaining || 0);
        return `<span class="priority-text-critical">⚠️ Expired ${days === 1 ? 'yesterday' : `${days} days ago`}</span>`;
    }
    if (donation.daysRemaining === 0) {
        return `<span class="priority-text-critical">⚠️ Expires today! Urgent review</span>`;
    }
    if (donation.daysRemaining === 1) {
        return `<span class="priority-text-high">⚡ Expires tomorrow (1 day)</span>`;
    }
    if (donation.daysRemaining === 2) {
        return `<span class="priority-text-high">⚡ Expires in 2 days</span>`;
    }
    if (donation.daysRemaining <= 5) {
        return `<span class="priority-text-medium">⏰ Expires in ${donation.daysRemaining} days</span>`;
    }
    return `<span class="priority-text-low">🍃 Expires in ${donation.daysRemaining} days</span>`;
}



/* ================= IMAGE UPLOAD ================= */

function compressImageFile(file, maxWidth = 750, maxHeight = 750, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL("image/jpeg", quality));
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/* ================= MAPTILER & LEAFLET LOCATION INTEGRATION ================= */

let donorMap = null;
let donorMarker = null;
let mapConfigCache = null;
let defaultMapCoords = [19.0760, 72.8777]; // Default fallback center (Mumbai / City Center)

let ngoFoodMapInstance = null;
let ngoMapMarkersLayer = null;
let isNgoMapViewActive = false;

async function initMapIntegration() {
    try {
        const config = await API.get("/map-config");
        mapConfigCache = config;
        setupDonorMapPicker();
    } catch (err) {
        console.warn("Could not load map configuration from server:", err);
        setupDonorMapPicker();
    }
}

function setupDonorMapPicker() {
    const container = document.getElementById("maptilerMapPicker");
    if (!container || typeof L === "undefined") return;

    if (donorMap) {
        donorMap.invalidateSize();
        return;
    }

    const latInput = document.getElementById("pickupLatitude");
    const lngInput = document.getElementById("pickupLongitude");
    let initialCenter = defaultMapCoords;

    if (latInput && lngInput && latInput.value && lngInput.value) {
        const lat = parseFloat(latInput.value);
        const lng = parseFloat(lngInput.value);
        if (!isNaN(lat) && !isNaN(lng)) {
            initialCenter = [lat, lng];
        }
    }

    donorMap = L.map("maptilerMapPicker").setView(initialCenter, 13);

    const maptilerKey = mapConfigCache?.maptilerKey;

    if (maptilerKey) {
        L.tileLayer(`https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${encodeURIComponent(maptilerKey)}`, {
            attribution: '© <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
            maxZoom: 19
        }).addTo(donorMap);
    } else {
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(donorMap);
    }

    donorMarker = L.marker(initialCenter, { draggable: true }).addTo(donorMap);

    donorMarker.on("dragend", function (e) {
        const pos = e.target.getLatLng();
        updateSelectedCoordinates(pos.lat, pos.lng);
        reverseGeocodePosition(pos.lat, pos.lng);
    });

    donorMap.on("click", function (e) {
        donorMarker.setLatLng(e.latlng);
        updateSelectedCoordinates(e.latlng.lat, e.latlng.lng);
        reverseGeocodePosition(e.latlng.lat, e.latlng.lng);
    });

    // Attempt gentle user geolocation if no coords pre-filled
    if (!latInput?.value && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const userLoc = [pos.coords.latitude, pos.coords.longitude];
                defaultMapCoords = userLoc;
                if (donorMap && donorMarker) {
                    donorMap.setView(userLoc, 15);
                    donorMarker.setLatLng(userLoc);
                    updateSelectedCoordinates(pos.coords.latitude, pos.coords.longitude);
                }
            },
            () => {},
            { timeout: 7000 }
        );
    }
}

function updateSelectedCoordinates(lat, lng) {
    const latInput = document.getElementById("pickupLatitude");
    const lngInput = document.getElementById("pickupLongitude");
    if (latInput) latInput.value = Number(lat).toFixed(6);
    if (lngInput) lngInput.value = Number(lng).toFixed(6);
    updateCoordsDisplay(lat, lng);
}

function updateCoordsDisplay(lat, lng) {
    const textEl = document.getElementById("mapCoordsText");
    const statusText = document.getElementById("mapStatusText");
    if (textEl && lat && lng) {
        textEl.textContent = `📍 ${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
    }
    if (statusText) {
        statusText.innerHTML = `✅ <strong>Location pinned</strong> (drag to fine-tune)`;
    }
}

async function reverseGeocodePosition(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        if (!res.ok) return;
        const data = await res.json();
        const inputEl = document.getElementById("pickupLocation");
        if (data && data.display_name && inputEl) {
            inputEl.value = data.display_name;
            showToast(`📍 Location pinned: ${data.display_name.slice(0, 45)}...`);
        }
    } catch {
        // Fallback silently if offline or blocked
    }
}

function detectUserLocation() {
    const btn = document.getElementById("btnDetectLocation");
    const origHtml = btn ? btn.innerHTML : "";

    if (!navigator.geolocation) {
        showToast("Geolocation is not supported by your browser.");
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `⏳ Locating...`;
    }

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            updateSelectedCoordinates(lat, lng);

            if (donorMap && donorMarker) {
                donorMarker.setLatLng([lat, lng]);
                donorMap.setView([lat, lng], 15);
                reverseGeocodePosition(lat, lng);
            }

            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `✅ Location Found`;
                setTimeout(() => { btn.innerHTML = origHtml; }, 2500);
            }
        },
        (error) => {
            console.warn("Geolocation error:", error);
            showToast("Could not retrieve current location. Please check browser permissions.");
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function resetMapPicker() {
    if (donorMarker && donorMap) {
        donorMarker.setLatLng(defaultMapCoords);
        donorMap.setView(defaultMapCoords, 13);
    }
    const statusText = document.getElementById("mapStatusText");
    const coordsText = document.getElementById("mapCoordsText");
    if (statusText) statusText.innerHTML = `📍 Click or drag pin to fine-tune exact pickup spot`;
    if (coordsText) coordsText.textContent = "";
}

function toggleNgoAvailableView() {
    isNgoMapViewActive = !isNgoMapViewActive;
    const btn = document.getElementById("btnNgoViewToggle");
    const mapWrapper = document.getElementById("ngoMapWrapper");
    const listWrapper = document.getElementById("ngoAvailableContainer");

    if (isNgoMapViewActive) {
        if (btn) btn.innerHTML = "📋 List View";
        if (mapWrapper) mapWrapper.classList.remove("hidden");
        if (listWrapper) listWrapper.classList.add("hidden");
        renderNgoFoodMap();
    } else {
        if (btn) btn.innerHTML = "🗺️ Map View";
        if (mapWrapper) mapWrapper.classList.add("hidden");
        if (listWrapper) listWrapper.classList.remove("hidden");
    }
}

function renderNgoFoodMap() {
    const mapEl = document.getElementById("ngoFoodMap");
    const emptyState = document.getElementById("ngoMapEmptyState");
    if (!mapEl || typeof L === "undefined") return;

    if (!ngoFoodMapInstance) {
        ngoFoodMapInstance = L.map("ngoFoodMap").setView([19.0760, 72.8777], 12);
        const maptilerKey = mapConfigCache?.maptilerKey;
        if (maptilerKey) {
            L.tileLayer(`https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${encodeURIComponent(maptilerKey)}`, {
                attribution: '© <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
                maxZoom: 19
            }).addTo(ngoFoodMapInstance);
        } else {
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
                maxZoom: 19
            }).addTo(ngoFoodMapInstance);
        }
        ngoMapMarkersLayer = L.layerGroup().addTo(ngoFoodMapInstance);
    }

    setTimeout(() => {
        if (ngoFoodMapInstance) ngoFoodMapInstance.invalidateSize();
    }, 150);

    if (ngoMapMarkersLayer) {
        ngoMapMarkersLayer.clearLayers();
    }

    const available = donations.filter(d => d.status === "Available" && !d.isExpired);
    const geoDonations = available.filter(d => d.latitude && d.longitude && !isNaN(d.latitude) && !isNaN(d.longitude));

    if (geoDonations.length === 0) {
        if (emptyState) emptyState.classList.remove("hidden");
        return;
    }

    if (emptyState) emptyState.classList.add("hidden");

    const markerBounds = [];
    const priorityColors = {
        CRITICAL: "#dc2626",
        HIGH: "#ea580c",
        MEDIUM: "#d97706",
        NORMAL: "#16a34a",
        LOW: "#16a34a",
        NEEDS_REVIEW: "#9333ea"
    };

    geoDonations.forEach(donation => {
        const lat = Number(donation.latitude);
        const lng = Number(donation.longitude);
        const prio = (donation.priority || "NORMAL").toUpperCase();
        const color = priorityColors[prio] || "#16a34a";

        const iconHtml = `
            <div style="background:${color};width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,0.3);border:2.5px solid #fff;color:#fff;font-size:14px;cursor:pointer;">
                🍱
            </div>
        `;
        const customIcon = L.divIcon({
            html: iconHtml,
            className: "custom-map-pin",
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            popupAnchor: [0, -15]
        });

        const marker = L.marker([lat, lng], { icon: customIcon });

        const popupContent = `
            <div class="map-popup-card" style="font-family:inherit;min-width:240px;max-width:280px;padding:4px;">
                ${donation.image ? `<img src="${escapeHTML(donation.image)}" alt="${escapeHTML(donation.foodName)}" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px;display:block;">` : ''}
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:6px;">
                    <strong style="font-size:14px;color:var(--ink);">${escapeHTML(donation.foodName)}</strong>
                    ${getPriorityBadgeHTML(donation)}
                </div>
                <p style="margin:2px 0;font-size:12px;color:var(--muted);">
                    ${escapeHTML(donation.foodType)} • <strong>${donation.quantity} kg</strong>
                </p>
                <p style="margin:2px 0;font-size:11px;color:var(--muted);">📍 ${escapeHTML(donation.pickupLocation)}</p>
                <p style="margin:2px 0;font-size:11px;">📅 Expiry: <strong>${formatDate(donation.expiryDate)}</strong></p>
                <div style="margin-top:10px;display:flex;gap:6px;">
                    <button class="small-btn small-btn-secondary" style="flex:1;font-size:11px;justify-content:center;" onclick="openFoodDetail(${donation.id})">👁️ Details</button>
                    <button class="small-btn" style="flex:1;font-size:11px;justify-content:center;" onclick="acceptDonation(${donation.id})">🤝 Accept</button>
                </div>
            </div>
        `;

        marker.bindPopup(popupContent);
        marker.addTo(ngoMapMarkersLayer);
        markerBounds.push([lat, lng]);
    });

    if (markerBounds.length > 0) {
        ngoFoodMapInstance.fitBounds(markerBounds, { padding: [40, 40], maxZoom: 15 });
    }
}


/* ================= MANDATORY FOOD IMAGE UPLOAD (CAMERA & GALLERY) ================= */

let activeWebcamStream = null;

function updateImageActionButtons() {
    const retakeBtn = document.getElementById("retakePhotoBtn");
    const chooseAnotherBtn = document.getElementById("chooseAnotherBtn");
    const removeBtn = document.getElementById("removePhotoBtn");

    if (imageSource === "camera") {
        if (retakeBtn) retakeBtn.style.display = "";
        if (chooseAnotherBtn) chooseAnotherBtn.style.display = "none";
        if (removeBtn) removeBtn.style.display = "";
    } else if (imageSource === "gallery") {
        if (retakeBtn) retakeBtn.style.display = "none";
        if (chooseAnotherBtn) chooseAnotherBtn.style.display = "";
        if (removeBtn) removeBtn.style.display = "";
    } else {
        if (retakeBtn) retakeBtn.style.display = "none";
        if (chooseAnotherBtn) chooseAnotherBtn.style.display = "none";
        if (removeBtn) removeBtn.style.display = "none";
    }
}

function triggerGallerySelection() {
    const galInput = document.getElementById("foodGalleryInput");
    if (galInput) {
        galInput.value = "";
        galInput.click();
    }
}

async function triggerCameraCapture() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const cameraInput = document.getElementById("foodCameraInput");
    if (cameraInput) cameraInput.value = "";

    // If mobile or if getUserMedia is not supported, trigger rear camera input
    if (isMobile || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (cameraInput) cameraInput.click();
        return;
    }

    // On desktop, open webcam capture modal
    const modal = document.getElementById("webcamModal");
    const video = document.getElementById("webcamVideo");
    if (!modal || !video) {
        if (cameraInput) cameraInput.click();
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        activeWebcamStream = stream;
        video.srcObject = stream;
        modal.classList.remove("hidden");
    } catch (err) {
        console.warn("Webcam access error or permission denied:", err);
        showToast("Camera access unavailable or denied. Opening file selector instead.");
        if (cameraInput) cameraInput.click();
    }
}

function closeWebcamModal() {
    if (activeWebcamStream) {
        activeWebcamStream.getTracks().forEach(track => track.stop());
        activeWebcamStream = null;
    }
    const modal = document.getElementById("webcamModal");
    if (modal) modal.classList.add("hidden");
}

function captureWebcamSnapshot() {
    const video = document.getElementById("webcamVideo");
    const canvas = document.getElementById("webcamCanvas");
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const base64Data = canvas.toDataURL("image/jpeg", 0.85);
    uploadedImageBase64 = base64Data;
    imageSource = "camera";

    const previewImg = document.getElementById("imagePreview");
    const container = document.getElementById("imagePreviewContainer");
    const reqBadge = document.getElementById("foodImageRequirementBadge");
    const errorEl = document.getElementById("foodImageError");

    if (previewImg) previewImg.src = base64Data;
    if (container) container.classList.remove("hidden");
    if (errorEl) errorEl.classList.add("hidden");
    if (reqBadge) {
        reqBadge.className = "status accepted";
        reqBadge.textContent = "Photo Attached ✅";
    }

    updateImageActionButtons();
    closeWebcamModal();
    showToast("📸 Food photo captured successfully!");
}

async function handleImageFileSelected(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    const errorEl = document.getElementById("foodImageError");
    if (errorEl) errorEl.classList.add("hidden");

    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type.toLowerCase())) {
        showToast("Invalid file type. Please upload a JPG, JPEG, PNG, or WebP photo.");
        if (errorEl) {
            errorEl.textContent = "Please upload a valid image file (JPG, JPEG, PNG, or WebP).";
            errorEl.classList.remove("hidden");
        }
        input.value = "";
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        showToast("Image size exceeds 5MB limit. Please choose a smaller photo.");
        if (errorEl) {
            errorEl.textContent = "Image size exceeds 5MB limit. Please choose a smaller photo.";
            errorEl.classList.remove("hidden");
        }
        input.value = "";
        return;
    }

    try {
        const compressed = await compressImageFile(file);
        uploadedImageBase64 = compressed;
        imageSource = (input.id === "foodCameraInput") ? "camera" : "gallery";

        const previewImg = document.getElementById("imagePreview");
        const container = document.getElementById("imagePreviewContainer");
        const reqBadge = document.getElementById("foodImageRequirementBadge");

        if (previewImg) previewImg.src = compressed;
        if (container) container.classList.remove("hidden");
        if (reqBadge) {
            reqBadge.className = "status accepted";
            reqBadge.textContent = "Photo Attached ✅";
        }

        updateImageActionButtons();
        showToast("📸 Food photo attached! Ready for submission.");
    } catch (err) {
        console.error("Image processing error:", err);
        showToast("Could not process the selected image.");
    }
}

function removeImage() {
    uploadedImageBase64 = null;
    imageSource = null;

    const camInput = document.getElementById("foodCameraInput");
    const galInput = document.getElementById("foodGalleryInput");
    const previewContainer = document.getElementById("imagePreviewContainer");
    const previewImg = document.getElementById("imagePreview");
    const reqBadge = document.getElementById("foodImageRequirementBadge");
    const errorEl = document.getElementById("foodImageError");

    if (camInput) camInput.value = "";
    if (galInput) galInput.value = "";
    if (previewImg) previewImg.src = "";
    if (previewContainer) previewContainer.classList.add("hidden");
    if (errorEl) errorEl.classList.add("hidden");
    if (reqBadge) {
        reqBadge.className = "status pending";
        reqBadge.textContent = "Photo Required";
    }

    updateImageActionButtons();
}


/* ================= AI FOOD PRIORITISATION (TEXT METADATA ONLY, NO IMAGES) ================= */

let aiProviderStatus = null;

async function checkAIStatus() {
    try {
        aiProviderStatus = await API.get("/ai/status");
    } catch {
        aiProviderStatus = { hasKey: false, model: "Deterministic Rule Engine" };
    }
}

async function requestAIPriorityExplanation() {
    const foodName = document.getElementById("foodName")?.value?.trim();
    const foodType = document.getElementById("foodType")?.value;
    const quantity = document.getElementById("foodQuantity")?.value;
    const expiryDate = document.getElementById("expiryDate")?.value?.trim();
    const preparedDate = document.getElementById("preparedDate")?.value?.trim();

    if (!expiryDate) return;

    try {
        // Send ONLY text metadata — NEVER send photographs or image URLs
        const res = await API.post("/ai/priority-explanation", {
            foodName,
            foodType,
            quantity: quantity ? Number(quantity) : null,
            expiryDate,
            preparedDate
        });

        const descEl = document.getElementById("aiPriorityDescription");
        if (descEl && res.explanation) {
            descEl.textContent = res.explanation;
        }
    } catch {
        // Keep deterministic preview description if AI service is unavailable
    }
}

function getDefaultFoodImage(type) {
    const images = {
        "Cooked Food": "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80",
        "Packaged Food": "https://images.unsplash.com/photo-1588964895597-cfccd6e2dbf9?auto=format&fit=crop&w=800&q=80",
        "Fruits": "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=800&q=80",
        "Vegetables": "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80",
        "Bakery Items": "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=800&q=80",
        "Dairy Products": "https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=800&q=80"
    };

    return images[type] || images["Cooked Food"];
}


/* ================= RENDERING DONOR LISTS ================= */

function renderRecentDonations() {
    const container = document.getElementById("recentDonations");
    if (!container || !currentUser) return;

    const userDonations = donations.filter(
        donation => donation.donorEmail.toLowerCase() === currentUser.email.toLowerCase()
    ).slice(0, 3);

    if (userDonations.length === 0) {
        container.innerHTML = emptyMessage(
            "🍱",
            "No donations yet",
            "Submit your first donation to see it listed here."
        );
        return;
    }

    container.innerHTML = userDonations.map(donationCard).join("");
}

function renderDonationHistory() {
    const container = document.getElementById("historyContainer");
    if (!container || !currentUser) return;

    const userDonations = donations.filter(
        donation => donation.donorEmail.toLowerCase() === currentUser.email.toLowerCase()
    );

    if (userDonations.length === 0) {
        container.innerHTML = emptyMessage(
            "📋",
            "No donation history",
            "Start by donating your surplus food using the Donate tab."
        );
        return;
    }

    container.innerHTML = userDonations.map(donation => {
        let actionButtons = `
            <button class="small-btn small-btn-secondary" onclick="openFoodDetail(${donation.id})">
                👁️ Details
            </button>
        `;

        if (donation.status === "Available") {
            actionButtons += `
                <button class="small-btn small-btn-danger" onclick="cancelDonation(${donation.id})">
                    🗑️ Cancel
                </button>
            `;
        } else if (donation.status === "Accepted") {
            actionButtons += `
                <button class="small-btn" onclick="markDonationCompleted(${donation.id})">
                    ✅ Complete Handover
                </button>
            `;
        }

        return `
            <div class="history-item">
                <div class="history-main" onclick="openFoodDetail(${donation.id})">
                    <img
                        class="history-image"
                        src="${escapeHTML(donation.image)}"
                        alt="${escapeHTML(donation.foodName)}"
                    >
                    <div>
                        <h3>${escapeHTML(donation.foodName)}</h3>
                        <p>
                            ${escapeHTML(donation.foodType)} • ${donation.quantity} kg
                            ${donation.acceptedByName ? ` • <strong style="color:var(--green)">NGO: ${escapeHTML(donation.acceptedByName)}</strong>` : ""}
                        </p>
                        <p>📍 ${escapeHTML(donation.pickupLocation)} • Expires: ${formatDate(donation.expiryDate)}</p>
                    </div>
                </div>

                <div class="history-actions">
                    <span class="status ${getStatusClass(donation.status)}">
                        ${escapeHTML(donation.status)}
                    </span>
                    ${actionButtons}
                </div>
            </div>
        `;
    }).join("");
}

function donationCard(donation) {
    return `
        <div class="donation-card" onclick="openFoodDetail(${donation.id})">
            <img
                class="donation-card-image"
                src="${escapeHTML(donation.image)}"
                alt="${escapeHTML(donation.foodName)}"
            >
            <div class="donation-content">
                <div class="donation-top">
                    <div>
                        <h3>${escapeHTML(donation.foodName)}</h3>
                        <span class="muted">${escapeHTML(donation.foodType)}</span>
                    </div>
                    <span class="status ${getStatusClass(donation.status)}">
                        ${escapeHTML(donation.status)}
                    </span>
                </div>

                <div class="meta-row">
                    <span>Quantity</span>
                    <strong>${donation.quantity} kg (~${Math.round(donation.quantity * 4)} meals)</strong>
                </div>

                <div class="meta-row">
                    <span>Priority</span>
                    <strong class="priority-text-${donation.priority.toLowerCase()}">${donation.priority}</strong>
                </div>

                <div class="meta-row">
                    <span>Location</span>
                    <span>${escapeHTML(donation.pickupLocation)}</span>
                </div>
            </div>
        </div>
    `;
}

function getStatusClass(status) {
    if (status === "Accepted") return "accepted";
    if (status === "Available") return "pending";
    if (status === "Completed") return "completed";
    if (status === "Cancelled") return "cancelled";
    return "";
}

function emptyMessage(icon, title, text) {
    return `
        <div class="empty">
            <div style="font-size:32px;margin-bottom:10px;">${icon}</div>
            <strong style="display:block;margin-bottom:6px;font-size:15px;color:var(--ink);">${title}</strong>
            <span style="font-size:13px;color:var(--muted);">${text}</span>
        </div>
    `;
}

function updateDonorImpact() {
    if (!currentUser) return;

    const userDonations = donations.filter(
        donation => donation.donorEmail.toLowerCase() === currentUser.email.toLowerCase()
    );

    const food = userDonations.reduce(
        (sum, donation) => sum + Number(donation.quantity || 0),
        0
    );

    const meals = Math.round(food * 4);

    const foodEl = document.getElementById("impactFood");
    const mealsEl = document.getElementById("impactMeals");
    const donEl = document.getElementById("impactDonations");

    if (foodEl) foodEl.textContent = `${food.toFixed(1)} kg`;
    if (mealsEl) mealsEl.textContent = meals.toLocaleString();
    if (donEl) donEl.textContent = userDonations.length;
}

function renderDonorNotifications() {
    const container = document.getElementById("notificationContainer");
    if (!container || !currentUser) return;

    const userNotifications = notifications.filter(
        notification => notification.email.toLowerCase() === currentUser.email.toLowerCase() && notification.role === "donor"
    );

    if (userNotifications.length === 0) {
        container.innerHTML = emptyMessage(
            "🔔",
            "No notifications",
            "You are all caught up with your donation alerts."
        );
        return;
    }

    container.innerHTML = userNotifications.map(notification => `
        <div class="notification">
            <div class="notification-icon">🔔</div>
            <div>
                <strong>${escapeHTML(notification.title)}</strong>
                <p>${escapeHTML(notification.message)}</p>
                <time>${escapeHTML(notification.time)}</time>
            </div>
        </div>
    `).join("");
}


/* ================= NGO DASHBOARD ================= */

async function showNGODashboard() {
    document.getElementById("homePage").classList.add("hidden");
    document.getElementById("donorPage").classList.add("hidden");
    document.getElementById("ngoPage").classList.remove("hidden");

    const name = currentUser?.name || "NGO Organization";

    const nameEl = document.getElementById("ngoName");
    const topNameEl = document.getElementById("ngoTopName");
    const welcomeEl = document.getElementById("ngoWelcome");

    if (nameEl) nameEl.textContent = name;
    if (topNameEl) topNameEl.textContent = name;
    if (welcomeEl) welcomeEl.textContent = name;

    renderNavAuth();
    await loadDonationsFromServer(false);
    await loadStatsFromServer(false);

    await ngoTab("overview");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

async function ngoTab(tab, button = null) {
    closeMobileSidebars();

    const tabs = document.querySelectorAll("#ngoPage .dashboard-tab");
    tabs.forEach(element => element.classList.add("hidden"));

    const selected = document.getElementById(`ngo-${tab}`);
    if (selected) {
        selected.classList.remove("hidden");
    }

    const links = document.querySelectorAll("#ngoPage .side-link");
    links.forEach(link => link.classList.remove("active"));

    if (button) {
        button.classList.add("active");
    } else {
        const map = {
            overview: 0,
            available: 1,
            accepted: 2,
            impact: 3,
            notifications: 4,
            settings: 5
        };
        if (links[map[tab]]) {
            links[map[tab]].classList.add("active");
        }
    }

    if (tab === "overview" || tab === "available" || tab === "accepted") {
        await loadDonationsFromServer(false);
    }

    if (tab === "overview") {
        updateNGODashboard();
    } else if (tab === "available") {
        renderNGOAvailable();
    } else if (tab === "accepted") {
        renderNGOAccepted();
    } else if (tab === "impact") {
        updateNGOImpact();
    } else if (tab === "notifications") {
        renderNGONotifications();
    }
}

function updateNGODashboard() {
    const available = donations.filter(donation => donation.status === "Available");

    const accepted = donations.filter(
        donation => (donation.status === "Accepted" || donation.status === "Completed") &&
                    donation.acceptedBy && donation.acceptedBy.toLowerCase() === currentUser?.email.toLowerCase()
    );

    const completed = donations.filter(
        donation => donation.status === "Completed" &&
                    donation.acceptedBy && donation.acceptedBy.toLowerCase() === currentUser?.email.toLowerCase()
    );

    const acceptedFood = accepted.reduce(
        (sum, donation) => sum + Number(donation.quantity || 0),
        0
    );

    const meals = Math.round(acceptedFood * 4);

    const availEl = document.getElementById("ngoAvailableCount");
    const foodEl = document.getElementById("ngoAcceptedFood");
    const mealsEl = document.getElementById("ngoMeals");
    const compEl = document.getElementById("ngoCompleted");

    if (availEl) availEl.textContent = available.length;
    if (foodEl) foodEl.textContent = `${acceptedFood.toFixed(1)} kg`;
    if (mealsEl) mealsEl.textContent = meals.toLocaleString();
    if (compEl) compEl.textContent = completed.length;

    renderNGORecentFood();
}

function renderNGOAvailable() {
    const container = document.getElementById("ngoAvailableContainer");
    if (!container) return;

    const search = (document.getElementById("ngoSearch")?.value || "").toLowerCase().trim();
    const filter = document.getElementById("ngoFoodFilter")?.value || "";
    const sort = document.getElementById("ngoSortFilter")?.value || "priority";

    // Expired donations must NOT appear among available donations that NGOs can accept
    let available = donations.filter(donation => {
        if (donation.status !== "Available" || donation.isExpired) return false;

        const nameMatch = (donation.foodName || "").toLowerCase().includes(search);
        const locMatch = (donation.pickupLocation || "").toLowerCase().includes(search);
        const descMatch = (donation.description || "").toLowerCase().includes(search);
        const typeMatch = (donation.foodType || "").toLowerCase().includes(search);
        const matchesSearch = !search || nameMatch || locMatch || descMatch || typeMatch;

        const matchesFilter = !filter || donation.foodType === filter;

        return matchesSearch && matchesFilter;
    });

    // Sorting: 1. Highest priority first, 2. Earliest expiry, 3. Stable secondary sort
    if (sort === "priority") {
        if (window.ShareBiteDateUtils) {
            available.sort((a, b) => window.ShareBiteDateUtils.compareDonationsByUrgency(a, b));
        } else {
            const weight = { "CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1 };
            available.sort((a, b) => (weight[b.priority] || 0) - (weight[a.priority] || 0));
        }
    } else if (sort === "quantity") {
        available.sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0));
    } else if (sort === "newest") {
        available.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    if (available.length === 0) {
        const isFiltered = Boolean(search || filter);
        container.innerHTML = emptyMessage(
            "🥗",
            isFiltered ? "No available donations match" : "No food donations available right now.",
            isFiltered
                ? "Try clearing your search or category filter to discover more surplus food."
                : "Surplus food shared by registered donors will appear here as soon as it is posted."
        );
        return;
    }

    container.innerHTML = available.map(donation => ngoFoodItem(donation)).join("");
}

function renderNGORecentFood() {
    const container = document.getElementById("ngoRecentFood");
    if (!container) return;

    // Filter out expired donations from available recommendations
    const available = donations
        .filter(donation => donation.status === "Available" && !donation.isExpired)
        .sort((a, b) => window.ShareBiteDateUtils ? window.ShareBiteDateUtils.compareDonationsByUrgency(a, b) : 0)
        .slice(0, 3);

    if (available.length === 0) {
        container.innerHTML = emptyMessage("🍃", "No food donations available right now.", "Surplus food shared by registered donors will appear here as soon as it is posted.");
        return;
    }

    container.innerHTML = available.map(donation => {
        const priorityBadgeHtml = getPriorityBadgeHTML(donation);
        const daysRemainingHtml = getDaysRemainingText(donation);
        const expiryFormatted = formatDate(donation.expiryDate);

        return `
            <div class="donation-card" onclick="openFoodDetail(${donation.id})">
                <img
                    class="donation-card-image"
                    src="${escapeHTML(donation.image)}"
                    alt="${escapeHTML(donation.foodName)}"
                    loading="lazy"
                >
                <div class="donation-content">
                    <div class="donation-top" style="align-items:flex-start;gap:8px;">
                        <div>
                            <h3 style="margin:0 0 2px 0;">${escapeHTML(donation.foodName)}</h3>
                            <span class="muted">${escapeHTML(donation.foodType)}</span>
                        </div>
                        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                            ${priorityBadgeHtml}
                            <span class="status ${getStatusClass(donation.status)}" style="font-size:10px;padding:2px 6px;">
                                ${escapeHTML(donation.status)}
                            </span>
                        </div>
                    </div>

                    <div class="meta-row">
                        <span>Quantity</span>
                        <strong>${donation.quantity} kg</strong>
                    </div>
                    <div class="meta-row">
                        <span>Donor</span>
                        <span>👤 ${escapeHTML(donation.donorName || "Community Member")}</span>
                    </div>
                    <div class="meta-row">
                        <span>Pickup Location</span>
                        <span>📍 ${escapeHTML(donation.pickupLocation)}</span>
                    </div>
                    <div class="meta-row">
                        <span>Best Before</span>
                        <strong>📅 ${expiryFormatted}</strong>
                    </div>
                    <div class="meta-row">
                        <span>Shelf Life</span>
                        <span style="font-size:11px;font-weight:600;">${daysRemainingHtml}</span>
                    </div>

                    <div style="margin-top:14px;display:flex;gap:8px;">
                        <button
                            class="small-btn"
                            style="width:100%;justify-content:center;"
                            onclick="event.stopPropagation(); acceptDonation(${donation.id})"
                        >
                            🤝 Accept Food
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

function ngoFoodItem(donation) {
    const priorityBadgeHtml = getPriorityBadgeHTML(donation);
    const daysRemainingHtml = getDaysRemainingText(donation);
    const expiryFormatted = formatDate(donation.expiryDate);

    return `
        <div class="food-list-item">
            <div class="food-main" onclick="openFoodDetail(${donation.id})">
                <img
                    src="${escapeHTML(donation.image)}"
                    class="food-list-image"
                    alt="${escapeHTML(donation.foodName)}"
                    loading="lazy"
                >
                <div style="flex:1;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                        <h3 style="margin:0;">${escapeHTML(donation.foodName)}</h3>
                        ${priorityBadgeHtml}
                        <span class="status ${getStatusClass(donation.status)}" style="font-size:10px;padding:2px 7px;">
                            ${escapeHTML(donation.status)}
                        </span>
                    </div>
                    <p style="margin:2px 0;">
                        <strong>${donation.quantity} kg</strong> •
                        ${escapeHTML(donation.foodType)} •
                        Donor: 👤 ${escapeHTML(donation.donorName || "Community Member")}
                    </p>
                    <p style="margin:2px 0;">📍 ${escapeHTML(donation.pickupLocation)}</p>
                    <p style="margin:2px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                        <span>📅 Expiry: <strong>${expiryFormatted}</strong></span>
                        <span>${daysRemainingHtml}</span>
                    </p>
                </div>
            </div>

            <div class="food-actions">
                <button
                    class="small-btn small-btn-secondary"
                    onclick="openFoodDetail(${donation.id})"
                >
                    👁️ Details
                </button>
                <button
                    class="small-btn"
                    onclick="acceptDonation(${donation.id})"
                >
                    🤝 Accept Food
                </button>
            </div>
        </div>
    `;
}

async function acceptDonation(id) {
    if (!currentUser) {
        showToast("Please login as an NGO first.");
        return;
    }

    const donation = donations.find(d => d.id === Number(id));
    if (donation && (donation.isExpired || donation.status === "Expired")) {
        showToast("⛔ This donation has expired and cannot be accepted for redistribution.");
        return;
    }

    try {
        showToast("Accepting food donation... ⏳");
        const updated = await API.post(`/donations/${id}/accept`);

        showToast(`Successfully accepted "${updated.foodName}"! 🤝 Saved to database.`);
        await loadDonationsFromServer();
        await loadNotificationsFromServer();
        await loadStatsFromServer();

        if (document.getElementById("foodDetailModal")) {
            closeModal("foodDetailModal");
        }
    } catch (err) {
        showToast("Error accepting donation: " + err.message);
    }
}

function renderNGOAccepted() {
    const container = document.getElementById("ngoAcceptedContainer");
    if (!container || !currentUser) return;

    const accepted = donations.filter(
        donation => (donation.status === "Accepted" || donation.status === "Completed") &&
                    donation.acceptedBy && donation.acceptedBy.toLowerCase() === currentUser.email.toLowerCase()
    );

    if (accepted.length === 0) {
        container.innerHTML = emptyMessage(
            "📦",
            "No accepted food yet",
            "Browse the Available Food tab to find and accept donations."
        );
        return;
    }

    container.innerHTML = accepted.map(donation => {
        let actionBtn = "";
        if (donation.status === "Accepted") {
            actionBtn = `
                <button class="small-btn" onclick="markDonationCompleted(${donation.id})">
                    ✅ Mark as Picked Up
                </button>
            `;
        }

        return `
            <div class="food-list-item">
                <div class="food-main" onclick="openFoodDetail(${donation.id})">
                    <img
                        src="${escapeHTML(donation.image)}"
                        class="food-list-image"
                        alt="${escapeHTML(donation.foodName)}"
                    >
                    <div>
                        <h3>${escapeHTML(donation.foodName)}</h3>
                        <p>${donation.quantity} kg • ${escapeHTML(donation.foodType)} • Donor: ${escapeHTML(donation.donorName)}</p>
                        <p>📍 Pickup: ${escapeHTML(donation.pickupLocation)}</p>
                        <p>⏰ Best Before: ${formatDate(donation.expiryDate)}</p>
                    </div>
                </div>

                <div class="food-actions">
                    <span class="status ${getStatusClass(donation.status)}">
                        ${escapeHTML(donation.status)}
                    </span>
                    <button class="small-btn small-btn-secondary" onclick="openFoodDetail(${donation.id})">
                        👁️ Details
                    </button>
                    ${actionBtn}
                </div>
            </div>
        `;
    }).join("");
}

async function markDonationCompleted(id) {
    if (!currentUser) return;

    try {
        showToast("Updating donation status... ⏳");
        const updated = await API.post(`/donations/${id}/complete`);

        showToast(`Donation "${updated.foodName}" marked as completed! 🌟`);
        closeModal("foodDetailModal");

        await loadDonationsFromServer();
        await loadNotificationsFromServer();
        await loadStatsFromServer();
    } catch (err) {
        showToast("Error updating donation: " + err.message);
    }
}

async function cancelDonation(id) {
    if (!currentUser || currentUser.role !== "donor") return;

    const donation = donations.find(item => item.id === id);
    if (!donation) return;

    if (!confirm(`Are you sure you want to cancel the donation for "${donation.foodName}"?`)) {
        return;
    }

    try {
        showToast("Cancelling donation... ⏳");
        await API.delete(`/donations/${id}`);

        showToast("Donation cancelled successfully.");
        closeModal("foodDetailModal");

        await loadDonationsFromServer();
        await loadNotificationsFromServer();
        await loadStatsFromServer();
    } catch (err) {
        showToast("Error cancelling donation: " + err.message);
    }
}

function updateNGOImpact() {
    if (!currentUser) return;

    const accepted = donations.filter(
        donation => (donation.status === "Accepted" || donation.status === "Completed") &&
                    donation.acceptedBy && donation.acceptedBy.toLowerCase() === currentUser.email.toLowerCase()
    );

    const food = accepted.reduce(
        (sum, donation) => sum + Number(donation.quantity || 0),
        0
    );

    const meals = Math.round(food * 4);

    const foodEl = document.getElementById("ngoImpactFood");
    const mealsEl = document.getElementById("ngoImpactMeals");
    const donEl = document.getElementById("ngoImpactDonations");

    if (foodEl) foodEl.textContent = `${food.toFixed(1)} kg`;
    if (mealsEl) mealsEl.textContent = meals.toLocaleString();
    if (donEl) donEl.textContent = accepted.length;
}

function renderNGONotifications() {
    const container = document.getElementById("ngoNotificationContainer");
    if (!container || !currentUser) return;

    const userNotifications = notifications.filter(
        notification => notification.email.toLowerCase() === currentUser.email.toLowerCase() && notification.role === "ngo"
    );

    if (userNotifications.length === 0) {
        container.innerHTML = emptyMessage(
            "🔔",
            "No notifications",
            "You are all caught up with your NGO updates."
        );
        return;
    }

    container.innerHTML = userNotifications.map(notification => `
        <div class="notification">
            <div class="notification-icon">🔔</div>
            <div>
                <strong>${escapeHTML(notification.title)}</strong>
                <p>${escapeHTML(notification.message)}</p>
                <time>${escapeHTML(notification.time)}</time>
            </div>
        </div>
    `).join("");
}


/* ================= FOOD DETAIL MODAL ================= */

function openFoodDetail(id) {
    const donation = donations.find(item => item.id === id);
    if (!donation) return;

    const modal = document.getElementById("foodDetailModal");
    const container = document.getElementById("foodDetailContent");
    if (!modal || !container) return;

    const isDonor = currentUser?.email && donation.donorEmail && currentUser.email.toLowerCase() === donation.donorEmail.toLowerCase();
    const isNGO = currentUser?.role === "ngo";
    const isAcceptedByCurrentNGO = isNGO && donation.acceptedBy && donation.acceptedBy.toLowerCase() === currentUser.email.toLowerCase();

    const priorityBadgeHtml = getPriorityBadgeHTML(donation);
    const daysRemainingHtml = getDaysRemainingText(donation);
    const expiryFormatted = formatDate(donation.expiryDate);
    const preparedFormatted = formatDate(donation.preparedDate);

    container.innerHTML = `
        <div class="food-detail-header">
            <span class="eyebrow">${escapeHTML(donation.foodType)}</span>
            <h2>${escapeHTML(donation.foodName)}</h2>
            <div class="food-detail-badges">
                <span class="status ${getStatusClass(donation.status)}">${escapeHTML(donation.status)}</span>
                ${priorityBadgeHtml}
            </div>
        </div>

        ${donation.isExpired ? `
            <div style="background:#fee2e2;border:1px solid #f87171;color:#991b1b;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;font-weight:600;">
                ⛔ Food has expired. Expired food must NOT be offered for redistribution.
            </div>
        ` : ''}

        <div class="food-detail-image-wrap">
            <img src="${escapeHTML(donation.image)}" alt="${escapeHTML(donation.foodName)}" class="food-detail-image">
        </div>

        <div class="food-detail-grid">
            <div class="detail-cell">
                <span class="detail-label">Quantity</span>
                <strong class="detail-val">${donation.quantity} kg (~${Math.round(donation.quantity * 4)} meals)</strong>
            </div>
            <div class="detail-cell">
                <span class="detail-label">Priority Status</span>
                <div style="margin-top:4px;">${daysRemainingHtml}</div>
            </div>
            <div class="detail-cell full">
                <span class="detail-label">Pickup Location</span>
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px;">
                    <strong class="detail-val" style="margin:0;">📍 ${escapeHTML(donation.pickupLocation)}</strong>
                    <a href="${donation.latitude && donation.longitude ? `https://www.google.com/maps/search/?api=1&query=${donation.latitude},${donation.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(donation.pickupLocation)}`}"
                       target="_blank" rel="noopener noreferrer"
                       class="small-btn small-btn-secondary" style="font-size:11px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;padding:4px 10px;">
                        🗺️ View in Google Maps ↗
                    </a>
                </div>
            </div>
            <div class="detail-cell">
                <span class="detail-label">Prepared Date</span>
                <strong class="detail-val">📅 ${preparedFormatted}</strong>
            </div>
            <div class="detail-cell">
                <span class="detail-label">Best Before / Expiry</span>
                <strong class="detail-val">⏰ ${expiryFormatted}</strong>
            </div>
            <div class="detail-cell">
                <span class="detail-label">Donor</span>
                <strong class="detail-val">👤 ${escapeHTML(donation.donorName || 'Community Member')}</strong>
            </div>
            ${currentUser ? `
            <div class="detail-cell">
                <span class="detail-label">Donor Contact</span>
                <strong class="detail-val">✉️ ${escapeHTML(donation.donorEmail || '-')}</strong>
            </div>` : `
            <div class="detail-cell">
                <span class="detail-label">Donor Status</span>
                <strong class="detail-val text-green">✅ Verified Registered Donor</strong>
            </div>`}
            ${donation.acceptedByName ? `
            <div class="detail-cell full">
                <span class="detail-label">Accepted By NGO</span>
                <strong class="detail-val text-green">🏢 ${escapeHTML(donation.acceptedByName)} (${escapeHTML(donation.acceptedBy)})</strong>
            </div>` : ''}
            ${donation.description ? `
            <div class="detail-cell full">
                <span class="detail-label">Food Information</span>
                <p class="detail-desc">${escapeHTML(donation.description)}</p>
            </div>` : ''}
        </div>

        <div class="food-detail-actions">
            ${isNGO && donation.status === "Available" && !donation.isExpired ? `
                <button class="btn btn-primary" onclick="acceptDonation(${donation.id})">
                    🤝 Accept Food Donation
                </button>
            ` : ''}
            ${isAcceptedByCurrentNGO && donation.status === "Accepted" ? `
                <button class="btn btn-primary" onclick="markDonationCompleted(${donation.id})">
                    ✅ Mark Picked Up & Completed
                </button>
            ` : ''}
            ${isDonor && donation.status === "Accepted" ? `
                <button class="btn btn-primary" onclick="markDonationCompleted(${donation.id})">
                    ✅ Confirm Handover Completed
                </button>
            ` : ''}
            ${isDonor && donation.status === "Available" ? `
                <button class="btn btn-danger" onclick="cancelDonation(${donation.id})">
                    🗑️ Cancel Donation
                </button>
            ` : ''}
            <button class="btn btn-secondary" onclick="closeModal('foodDetailModal')">
                Close
            </button>
        </div>
    `;

    modal.classList.remove("hidden");
}


/* ================= DARK MODE & SETTINGS ================= */

function toggleDarkMode() {
    document.body.classList.toggle("dark");
    const enabled = document.body.classList.contains("dark");
    localStorage.setItem("foodshareDarkMode", enabled);
    updateThemeButtons(enabled);
}

function loadDarkMode() {
    const enabled = localStorage.getItem("foodshareDarkMode") === "true";
    if (enabled) {
        document.body.classList.add("dark");
    }
    updateThemeButtons(enabled);
}

function updateThemeButtons(enabled) {
    document.querySelectorAll("#themeSwitchCheckbox, .theme-switch__checkbox, .switch input").forEach(cb => {
        cb.checked = enabled;
    });

    document.querySelectorAll(".theme-btn").forEach(button => {
        button.textContent = enabled ? "☀️" : "🌙";
    });

    const donorToggle = document.getElementById("darkToggleDonor");
    if (donorToggle) {
        donorToggle.classList.toggle("on", enabled);
    }

    const ngoToggle = document.getElementById("darkToggleNGO");
    if (ngoToggle) {
        ngoToggle.classList.toggle("on", enabled);
    }
}

function toggleSetting(button) {
    button.classList.toggle("on");
    showToast("Setting updated.");
}

async function clearNotifications() {
    if (!currentUser) return;
    if (!confirm("Are you sure you want to clear your notification history?")) return;

    try {
        await API.post("/notifications/clear");
        notifications = [];
        showToast("Notifications cleared.");

        if (currentUser.role === "donor") {
            renderDonorNotifications();
        } else {
            renderNGONotifications();
        }
    } catch (err) {
        showToast("Error clearing notifications: " + err.message);
    }
}

async function resetAllData() {
    if (!confirm("Are you sure you want to reset data? This will clear all donations.")) {
        return;
    }

    try {
        showToast("Resetting data... ⏳");
        await API.post("/reset-demo");
        showToast("Data reset successfully! 🍃");

        await loadDonationsFromServer();
        await loadStatsFromServer();
        await loadNotificationsFromServer();
    } catch (err) {
        showToast("Reset error: " + err.message);
    }
}


/* ================= MOBILE SIDEBAR ================= */

function toggleSidebar(pageId) {
    const page = document.getElementById(pageId);
    if (!page) return;

    const sidebar = page.querySelector(".sidebar");
    const backdropId = pageId === "donorPage" ? "donorBackdrop" : "ngoBackdrop";
    const backdrop = document.getElementById(backdropId);

    if (sidebar) sidebar.classList.toggle("open");
    if (backdrop) backdrop.classList.toggle("active");
}

function closeMobileSidebars() {
    document.querySelectorAll(".sidebar").forEach(s => s.classList.remove("open"));
    document.querySelectorAll(".sidebar-backdrop").forEach(b => b.classList.remove("active"));
}


/* ================= LOGOUT ================= */

async function logout() {
    try {
        await API.post("/auth/logout");
    } catch {
        // Continue logout locally even if server error
    }

    currentUser = null;
    authToken = null;
    localStorage.removeItem("foodshareCurrentUser");
    localStorage.removeItem("foodshareToken");

    document.getElementById("donorPage").classList.add("hidden");
    document.getElementById("ngoPage").classList.add("hidden");
    document.getElementById("homePage").classList.remove("hidden");

    renderNavAuth();
    loadStatsFromServer();

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    showToast("You have been logged out.");
}


/* ================= TOAST ================= */

function showToast(message) {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(function () {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}


/* ================= UTILITIES ================= */

function formatDate(dateString) {
    if (!dateString) return "-";
    if (window.ShareBiteDateUtils) {
        return window.ShareBiteDateUtils.formatDateToDisplay(dateString);
    }
    const str = String(dateString).trim();
    if (str.includes("/")) return str;
    const parts = str.split("-");
    if (parts.length === 3) {
        return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
    }
    return str;
}

function escapeHTML(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}