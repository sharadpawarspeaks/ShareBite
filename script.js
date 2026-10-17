/* =========================================================
   SHAREBITE FRONTEND - FULL-STACK CLIENT
   ========================================================= */

/* ================= STATE ================= */

let currentRole = null;
let authMode = "signup";
let uploadedImageBase64 = null;
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
    await initGoogleMaps();

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
    } catch {
        // Fallback calculations from local array
        updateHomeStatsLocal();
    }
}

async function loadDonationsFromServer(updateViews = true) {
    try {
        const data = await API.get("/donations");
        donations = data;

        if (updateViews) {
            updateHomeStatsLocal();
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

    if (foodElement) foodElement.textContent = `${stats.totalFood.toFixed(1)} kg`;
    if (mealsElement) mealsElement.textContent = stats.totalMeals.toLocaleString();
    if (donationsElement) donationsElement.textContent = stats.totalDonations;
}

function updateHomeStatsLocal() {
    const totalFood = donations.reduce(
        (sum, donation) => sum + Number(donation.quantity || 0),
        0
    );
    const totalMeals = Math.round(totalFood * 4);

    const foodElement = document.getElementById("heroFood");
    const mealsElement = document.getElementById("heroMeals");
    const donationsElement = document.getElementById("heroDonations");

    if (foodElement) foodElement.textContent = `${totalFood.toFixed(1)} kg`;
    if (mealsElement) mealsElement.textContent = totalMeals.toLocaleString();
    if (donationsElement) donationsElement.textContent = donations.length;
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


function forgotPassword() {
    const email = document.getElementById("authEmail").value.trim();
    if (email) {
        showToast(`Password reset link sent to ${email} 📧`);
    } else {
        showToast("Please enter your email above, then click 'Forgot password?'");
    }
}


/* ================= 1-CLICK DEMO LOGIN ================= */

async function demoLogin(role) {
    closeAllModals();
    showToast(`Logging in as Demo ${role === "donor" ? "Donor (Sarah Jenkins)" : "NGO (Hope Shelter)"}... ⚡`);

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

    if (tab === "donate" && googleMapInstance && window.google) {
        setTimeout(() => {
            google.maps.event.trigger(googleMapInstance, "resize");
            const pos = googleMapMarker?.getPosition() || defaultMapCoords;
            googleMapInstance.setCenter(pos);
        }, 100);
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
}

function attachDateInputMask(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener("input", function () {
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
}

function setupDonationForm() {
    const form = document.getElementById("donationForm");
    if (!form) return;

    const prepInput = document.getElementById("preparedDate");
    const expInput = document.getElementById("expiryDate");
    attachDateInputMask(prepInput);
    attachDateInputMask(expInput);

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

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
            showToast("⚠️ Food photo is required. Please upload an image of the food.");
            if (imgErrorEl) {
                imgErrorEl.textContent = "Food photo is required. Please upload an image (JPG, PNG, WebP).";
                imgErrorEl.classList.remove("hidden");
            }
            const box = document.getElementById("foodUploadBox");
            if (box) {
                box.scrollIntoView({ behavior: "smooth", block: "center" });
                box.style.borderColor = "var(--danger, #dc2626)";
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
    const p = (donation.priority || "LOW").toUpperCase();
    if (donation.isExpired || donation.status === "Expired") {
        return `<span class="priority-badge critical" title="Food has expired. Expired food must not be offered for redistribution.">🔴 CRITICAL</span>`;
    }
    if (p === "CRITICAL") {
        return `<span class="priority-badge critical" title="Food expires today or requires urgent review">🔴 CRITICAL</span>`;
    }
    if (p === "HIGH") {
        return `<span class="priority-badge high" title="Food expires within 1–2 days">🟠 HIGH</span>`;
    }
    if (p === "MEDIUM") {
        return `<span class="priority-badge medium" title="Food expires in 3–5 days">🟡 MEDIUM</span>`;
    }
    return `<span class="priority-badge low" title="Food expires in more than 5 days">🟢 LOW</span>`;
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

/* ================= GOOGLE MAPS LOCATION PICKER INTEGRATION ================= */

let googleMapInstance = null;
let googleMapMarker = null;
let googleMapGeocoder = null;
let googlePlacesAutocomplete = null;
let isGoogleMapsLoaded = false;
let defaultMapCoords = { lat: 19.0760, lng: 72.8777 }; // Default fallback center (Mumbai / City Center)

async function initGoogleMaps() {
    try {
        const config = await API.get("/config/maps");
        if (config && config.hasKey && config.key) {
            loadGoogleMapsScript(config.key);
        } else {
            updateMapPlaceholderState(false);
        }
    } catch (err) {
        console.warn("Could not check Google Maps configuration:", err);
    }
}

function loadGoogleMapsScript(apiKey) {
    if (window.google && window.google.maps) {
        setupGoogleMapPicker();
        return;
    }

    if (document.getElementById("googleMapsScriptTag")) {
        return;
    }

    window.onGoogleMapsLoaded = function () {
        isGoogleMapsLoaded = true;
        setupGoogleMapPicker();
    };

    const script = document.createElement("script");
    script.id = "googleMapsScriptTag";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=onGoogleMapsLoaded`;
    script.async = true;
    script.defer = true;
    script.onerror = function () {
        console.error("Failed to load Google Maps script. Check your API key and enabled APIs.");
        showToast("⚠️ Could not load Google Maps. Please check your API key.");
    };
    document.head.appendChild(script);
}

function updateMapPlaceholderState(hasKey) {
    const badge = document.getElementById("mapLoadedBadge");
    const placeholder = document.getElementById("mapPickerPlaceholder");
    if (badge) {
        if (hasKey) {
            badge.classList.remove("hidden");
            badge.textContent = "🗺️ Google Maps Active";
        } else {
            badge.classList.add("hidden");
        }
    }
    if (placeholder && hasKey) {
        placeholder.style.display = "none";
    }
}

function setupGoogleMapPicker() {
    const mapEl = document.getElementById("googleMapPicker");
    const inputEl = document.getElementById("pickupLocation");
    if (!mapEl || !window.google || !window.google.maps) return;

    updateMapPlaceholderState(true);

    const latInput = document.getElementById("pickupLatitude");
    const lngInput = document.getElementById("pickupLongitude");
    let initialCenter = defaultMapCoords;
    let hasExistingCoords = false;

    if (latInput && lngInput && latInput.value && lngInput.value) {
        const lat = parseFloat(latInput.value);
        const lng = parseFloat(lngInput.value);
        if (!isNaN(lat) && !isNaN(lng)) {
            initialCenter = { lat, lng };
            hasExistingCoords = true;
        }
    }

    googleMapGeocoder = new google.maps.Geocoder();

    googleMapInstance = new google.maps.Map(mapEl, {
        center: initialCenter,
        zoom: hasExistingCoords ? 16 : 14,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        gestureHandling: "cooperative"
    });

    googleMapMarker = new google.maps.Marker({
        position: initialCenter,
        map: googleMapInstance,
        draggable: true,
        animation: google.maps.Animation.DROP,
        title: "Drag to set exact pickup location"
    });

    updateCoordsDisplay(initialCenter.lat, initialCenter.lng);

    googleMapMarker.addListener("dragend", function () {
        const pos = googleMapMarker.getPosition();
        if (!pos) return;
        const lat = pos.lat();
        const lng = pos.lng();
        updateSelectedCoordinates(lat, lng);
        reverseGeocodePosition(lat, lng);
    });

    googleMapInstance.addListener("click", function (event) {
        if (!event.latLng) return;
        const lat = event.latLng.lat();
        const lng = event.latLng.lng();
        googleMapMarker.setPosition(event.latLng);
        updateSelectedCoordinates(lat, lng);
        reverseGeocodePosition(lat, lng);
    });

    if (inputEl && window.google.maps.places) {
        googlePlacesAutocomplete = new google.maps.places.Autocomplete(inputEl, {
            fields: ["formatted_address", "geometry", "name"]
        });

        googlePlacesAutocomplete.bindTo("bounds", googleMapInstance);

        googlePlacesAutocomplete.addListener("place_changed", function () {
            const place = googlePlacesAutocomplete.getPlace();
            if (!place.geometry || !place.geometry.location) {
                return;
            }

            const loc = place.geometry.location;
            const lat = loc.lat();
            const lng = loc.lng();

            googleMapInstance.setCenter(loc);
            googleMapInstance.setZoom(16);
            googleMapMarker.setPosition(loc);

            updateSelectedCoordinates(lat, lng);

            if (place.formatted_address) {
                inputEl.value = place.formatted_address;
            }
        });
    }

    if (!hasExistingCoords && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                defaultMapCoords = userLoc;
                if (googleMapInstance) {
                    googleMapInstance.setCenter(userLoc);
                    if (googleMapMarker) googleMapMarker.setPosition(userLoc);
                    updateCoordsDisplay(userLoc.lat, userLoc.lng);
                }
            },
            () => {},
            { timeout: 8000 }
        );
    }
}

function updateSelectedCoordinates(lat, lng) {
    const latInput = document.getElementById("pickupLatitude");
    const lngInput = document.getElementById("pickupLongitude");
    if (latInput) latInput.value = lat.toFixed(6);
    if (lngInput) lngInput.value = lng.toFixed(6);
    updateCoordsDisplay(lat, lng);
}

function updateCoordsDisplay(lat, lng) {
    const textEl = document.getElementById("mapCoordsText");
    const statusText = document.getElementById("mapStatusText");
    if (textEl && lat && lng) {
        textEl.textContent = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
    if (statusText) {
        statusText.innerHTML = `✅ <strong>Location pinned</strong> (drag to fine-tune)`;
    }
}

function reverseGeocodePosition(lat, lng) {
    if (!googleMapGeocoder) return;
    const latLng = { lat, lng };

    googleMapGeocoder.geocode({ location: latLng }, function (results, status) {
        if (status === "OK" && results && results[0]) {
            const inputEl = document.getElementById("pickupLocation");
            if (inputEl) {
                inputEl.value = results[0].formatted_address;
            }
            showToast(`📍 Location pinned: ${results[0].formatted_address.slice(0, 45)}...`);
        }
    });
}

function detectUserLocation() {
    const btn = document.getElementById("btnDetectLocation");
    const inputEl = document.getElementById("pickupLocation");
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

            if (googleMapInstance && googleMapMarker && window.google) {
                const userLatLng = new google.maps.LatLng(lat, lng);
                googleMapInstance.setCenter(userLatLng);
                googleMapInstance.setZoom(16);
                googleMapMarker.setPosition(userLatLng);
                reverseGeocodePosition(lat, lng);
            } else {
                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
                    const data = await res.json();
                    if (data && data.display_name && inputEl) {
                        inputEl.value = data.display_name;
                        showToast("📍 Current location detected!");
                    } else if (inputEl) {
                        inputEl.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
                    }
                } catch {
                    if (inputEl) inputEl.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
                }
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

async function saveGoogleMapsKeyFromUI() {
    const input = document.getElementById("inputGoogleMapsKey");
    if (!input || !input.value.trim()) {
        showToast("Please paste your Google Maps API key first.");
        return;
    }

    const key = input.value.trim();
    try {
        showToast("Saving Google Maps API key... ⏳");
        const res = await API.post("/config/maps", { apiKey: key });
        showToast("✅ " + res.message);
        loadGoogleMapsScript(key);
    } catch (err) {
        showToast("Error saving Google Maps key: " + err.message);
    }
}

function resetMapPicker() {
    if (googleMapMarker && googleMapInstance) {
        googleMapMarker.setPosition(defaultMapCoords);
        googleMapInstance.setCenter(defaultMapCoords);
        googleMapInstance.setZoom(14);
    }
    const statusText = document.getElementById("mapStatusText");
    const coordsText = document.getElementById("mapCoordsText");
    if (statusText) statusText.innerHTML = `📍 Click or drag pin to fine-tune exact pickup spot`;
    if (coordsText) coordsText.textContent = "";
}

/* ================= REAL AI VISION INTEGRATION ================= */

let isAnalyzingImage = false;
let lastAIVerifiedStatus = null; // { isFood: boolean, isSafeForDonation: boolean, foodName?: string }
let latestAISuggestions = null;

function setupImageUpload() {
    const input = document.getElementById("foodImage");
    if (!input) return;

    input.addEventListener("change", async function () {
        const file = this.files[0];
        if (!file) return;

        const errorEl = document.getElementById("foodImageError");
        const uploadBox = document.getElementById("foodUploadBox");
        if (errorEl) errorEl.classList.add("hidden");
        if (uploadBox) uploadBox.style.borderColor = "";

        const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        if (!validTypes.includes(file.type.toLowerCase())) {
            showToast("Invalid file type. Please upload a JPG, JPEG, PNG, or WebP photo.");
            if (errorEl) {
                errorEl.textContent = "Please upload a valid image file (JPG, JPEG, PNG, or WebP).";
                errorEl.classList.remove("hidden");
            }
            this.value = "";
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            showToast("Image size exceeds 5MB limit. Please choose a smaller photo.");
            if (errorEl) {
                errorEl.textContent = "Image size exceeds 5MB limit. Please choose a smaller photo.";
                errorEl.classList.remove("hidden");
            }
            this.value = "";
            return;
        }

        try {
            const compressed = await compressImageFile(file);
            uploadedImageBase64 = compressed;

            const previewImg = document.getElementById("imagePreview");
            const container = document.getElementById("imagePreviewContainer");
            const reqBadge = document.getElementById("foodImageRequirementBadge");

            if (previewImg) {
                previewImg.src = compressed;
                previewImg.className = "food-preview";
            }
            if (container) container.classList.remove("hidden");
            if (reqBadge) {
                reqBadge.className = "status accepted";
                reqBadge.textContent = "Photo Attached ✅";
            }

            showToast("📸 Food photo attached! Ready for submission.");
        } catch (err) {
            console.error("Image processing error:", err);
            showToast("Could not process the selected image.");
        }
    });
}

function removeImage() {
    uploadedImageBase64 = null;

    const input = document.getElementById("foodImage");
    const previewContainer = document.getElementById("imagePreviewContainer");
    const previewImg = document.getElementById("imagePreview");
    const reqBadge = document.getElementById("foodImageRequirementBadge");
    const errorEl = document.getElementById("foodImageError");

    if (input) input.value = "";
    if (previewImg) {
        previewImg.src = "";
        previewImg.className = "food-preview";
    }
    if (previewContainer) previewContainer.classList.add("hidden");
    if (errorEl) errorEl.classList.add("hidden");
    if (reqBadge) {
        reqBadge.className = "status pending";
        reqBadge.textContent = "Required";
    }
}

async function triggerAIVisionAnalysis() {
    if (!uploadedImageBase64) {
        showToast("Please select or upload a food photo first. 📸");
        const input = document.getElementById("foodImage");
        if (input) input.click();
        return;
    }

    isAnalyzingImage = true;
    const btn = document.getElementById("btnAnalyzeAI");
    const originalText = btn ? btn.innerHTML : "";
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `⏳ Inspecting with Real AI...`;
    }

    const previewImg = document.getElementById("imagePreview");
    const overlay = document.getElementById("imageVerificationOverlay");
    const alertEl = document.getElementById("aiRejectionAlert");
    const reqBadge = document.getElementById("foodImageRequirementBadge");

    if (alertEl) alertEl.classList.add("hidden");
    if (previewImg) previewImg.className = "food-preview verifying";
    if (overlay) {
        overlay.className = "image-verification-overlay verifying";
        overlay.innerHTML = "🔄 Real AI inspecting food...";
        overlay.classList.remove("hidden");
    }
    if (reqBadge) {
        reqBadge.className = "status pending";
        reqBadge.textContent = "AI Verifying...";
    }

    const card = document.getElementById("aiAnalysisCard");
    const resultsEl = document.getElementById("aiAnalysisResults");
    const freshnessBadge = document.getElementById("aiFreshnessBadge");
    const modelBadge = document.getElementById("aiModelBadge");

    if (card) card.classList.remove("hidden");
    if (resultsEl) {
        resultsEl.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;color:var(--muted);">
                <span style="font-size:20px;">🔄</span>
                <span>Inspecting food image with Groq Llama 3.2 Vision model...</span>
            </div>
        `;
    }

    try {
        showToast("Inspecting photo with Groq Vision AI... ⚡");
        const analysis = await API.post("/ai/analyze-image", { image: uploadedImageBase64 });
        latestAISuggestions = analysis;

        // -------------------------------------------------------------
        // NON-FOOD DETECTION ADVISORY (Optional Notice, not blocking)
        // -------------------------------------------------------------
        if (!analysis.isFood) {
            lastAIVerifiedStatus = { isFood: false, isSafeForDonation: false };

            if (previewImg) previewImg.className = "food-preview";
            if (overlay) {
                overlay.className = "image-verification-overlay rejected";
                overlay.innerHTML = "💡 Advisory: Might not be food";
                overlay.classList.remove("hidden");
            }
            if (reqBadge) {
                reqBadge.className = "status";
                reqBadge.textContent = "Photo Attached (Advisory)";
            }

            const msgEl = document.getElementById("aiRejectionMessage");
            const badgeEl = document.getElementById("aiRejectionBadge");
            if (msgEl) {
                msgEl.textContent = analysis.rejectionReason || "AI did not clearly recognize food in this image. You can upload a clearer photo or keep it and continue with your donation.";
            }
            if (badgeEl) {
                badgeEl.textContent = "Advisory (Optional)";
            }
            if (alertEl) {
                alertEl.classList.remove("hidden");
                alertEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
            if (card) card.classList.add("hidden");

            showToast("💡 AI Advisory: Image may not depict food (submission is still allowed).");
            return;
        }

        // -------------------------------------------------------------
        // FOOD SAFETY / SPOILAGE ADVISORY
        // -------------------------------------------------------------
        if (analysis.isFood && !analysis.isSafeForDonation) {
            lastAIVerifiedStatus = { isFood: true, isSafeForDonation: false };

            if (previewImg) previewImg.className = "food-preview";
            if (overlay) {
                overlay.className = "image-verification-overlay rejected";
                overlay.innerHTML = "⚠️ Freshness Concern Flagged";
                overlay.classList.remove("hidden");
            }
            if (reqBadge) {
                reqBadge.className = "status pending";
                reqBadge.textContent = "Freshness Concern";
            }

            const msgEl = document.getElementById("aiRejectionMessage");
            const badgeEl = document.getElementById("aiRejectionBadge");
            if (msgEl) {
                msgEl.textContent = analysis.safetyWarning || analysis.rejectionReason || "AI noticed potential freshness issues. Please ensure the food is fresh and safe before submitting.";
            }
            if (badgeEl) {
                badgeEl.textContent = "Safety Advisory";
            }
            if (alertEl) {
                alertEl.classList.remove("hidden");
                alertEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
            if (card) card.classList.add("hidden");

            showToast("⚠️ AI Warning: Freshness concern flagged (submission is still allowed).");
            return;
        }

        // -------------------------------------------------------------
        // VERIFIED REAL & SAFE FOOD
        // -------------------------------------------------------------
        lastAIVerifiedStatus = { isFood: true, isSafeForDonation: true, foodName: analysis.foodName };

        if (previewImg) previewImg.className = "food-preview verified";
        if (overlay) {
            overlay.className = "image-verification-overlay verified";
            overlay.innerHTML = `✅ AI Recognized: ${escapeHTML(analysis.foodName || 'Food Detected')}`;
            overlay.classList.remove("hidden");
        }
        if (reqBadge) {
            reqBadge.className = "status accepted";
            reqBadge.textContent = "✅ AI Analyzed";
        }
        if (alertEl) alertEl.classList.add("hidden");

        if (modelBadge) {
            modelBadge.textContent = analysis.aiProvider || "Groq Multimodal Vision AI";
        }

        if (freshnessBadge) {
            freshnessBadge.textContent = analysis.visualFreshness || "Fresh";
            freshnessBadge.className = "status accepted";
        }

        if (resultsEl) {
            resultsEl.innerHTML = `
                <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:8px;margin-bottom:10px;">
                    <div><strong>🍽️ Detected Dish:</strong> ${escapeHTML(analysis.foodName)}</div>
                    <div><strong>📦 Category:</strong> ${escapeHTML(analysis.foodType)}</div>
                    <div><strong>⚖️ Est. Quantity:</strong> ${analysis.estimatedQuantityKg} kg (~${Math.round(analysis.estimatedQuantityKg * 4)} meals)</div>
                    <div><strong>🛡️ Safe for Donation:</strong> <span style="color:var(--green);font-weight:700;">✅ Fresh & Safe</span></div>
                    <div><strong>⚡ Urgency Priority:</strong> <span class="priority-text-${(analysis.priority || 'medium').toLowerCase()}">${analysis.priority}</span></div>
                    <div><strong>📅 Shelf-life estimate:</strong> ~${analysis.suggestedExpiryDays || 2} days</div>
                </div>
                <div style="background:rgba(255,255,255,0.8);padding:8px 12px;border-radius:8px;border-left:3px solid var(--green);">
                    <strong>AI Visual Inspection Notes:</strong> ${escapeHTML(analysis.description)}
                </div>
            `;
        }

        showToast(`✅ Food Identified: "${analysis.foodName}"! Click 'Auto-Fill Form' to apply AI suggestions. ✨`);
    } catch (err) {
        console.error("AI analysis error:", err);
        const errMsg = err.message || "";

        if (previewImg) previewImg.className = "food-preview";

        if (errMsg.includes("API_KEY") || errMsg.includes("Key Required") || errMsg.includes("API key")) {
            showToast("ℹ️ Groq API key is not configured in .env. AI analysis is optional — you can still submit!");
            if (overlay) {
                overlay.className = "image-verification-overlay";
                overlay.style.background = "rgba(75, 85, 99, 0.85)";
                overlay.innerHTML = "ℹ️ AI Optional (No Groq Key)";
                overlay.classList.remove("hidden");
            }
            if (reqBadge) {
                reqBadge.className = "status";
                reqBadge.textContent = "Photo Attached";
            }
        } else {
            showToast("ℹ️ AI analysis skipped (" + errMsg + "). You can still submit your donation!");
            if (overlay) {
                overlay.className = "image-verification-overlay";
                overlay.style.background = "rgba(75, 85, 99, 0.85)";
                overlay.innerHTML = "ℹ️ AI Skipped";
                overlay.classList.remove("hidden");
            }
            if (reqBadge) {
                reqBadge.className = "status";
                reqBadge.textContent = "Photo Attached";
            }
        }

        if (resultsEl) {
            resultsEl.innerHTML = `<span style="color:var(--muted)">AI inspection unavailable: ${escapeHTML(errMsg)}. <strong>AI analysis is optional</strong> — you can complete the form and submit your donation directly.</span>`;
        }
    } finally {
        isAnalyzingImage = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText || `✨ Analyze Food with AI (Optional)`;
        }
    }
}

function applyAISuggestions() {
    if (!latestAISuggestions) {
        showToast("No AI analysis available. Please upload an image first.");
        return;
    }

    const { foodName, foodType, estimatedQuantityKg, description, suggestedExpiryDays } = latestAISuggestions;

    if (foodName) {
        const el = document.getElementById("foodName");
        if (el) el.value = foodName;
    }

    if (foodType) {
        const el = document.getElementById("foodType");
        if (el) {
            for (let i = 0; i < el.options.length; i++) {
                if (el.options[i].value.toLowerCase() === foodType.toLowerCase() ||
                    foodType.toLowerCase().includes(el.options[i].value.toLowerCase())) {
                    el.selectedIndex = i;
                    break;
                }
            }
        }
    }

    if (estimatedQuantityKg) {
        const el = document.getElementById("foodQuantity");
        if (el) el.value = estimatedQuantityKg;
    }

    if (description) {
        const el = document.getElementById("foodDescription");
        if (el) el.value = description;
    }

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const prepEl = document.getElementById("preparedDate");
    if (prepEl) prepEl.value = todayStr;

    const daysToAdd = suggestedExpiryDays || 2;
    const expiry = new Date(today);
    expiry.setDate(expiry.getDate() + daysToAdd);
    const expStr = expiry.toISOString().split("T")[0];
    const expEl = document.getElementById("expiryDate");
    if (expEl) expEl.value = expStr;

    updatePriorityPreview();

    showToast("Form auto-filled from Real AI analysis! 🪄");
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
        container.innerHTML = emptyMessage(
            "🥗",
            "No available donations match",
            "Try clearing your search or category filter to discover more surplus food."
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
        container.innerHTML = emptyMessage("🍃", "No food donations waiting", "Surplus food posted by local donors will appear here.");
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
            <div class="detail-cell">
                <span class="detail-label">Donor Contact</span>
                <strong class="detail-val">✉️ ${escapeHTML(donation.donorEmail || '-')}</strong>
            </div>
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