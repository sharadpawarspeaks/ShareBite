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

    // Priority input reactive listeners
    ["expiryDate", "foodQuantity", "preparedDate", "foodType"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", updatePriorityPreview);
            el.addEventListener("change", updatePriorityPreview);
        }
    });

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
    document.getElementById("authModal").classList.remove("hidden");
}

function openRoleModal(role) {
    currentRole = role;
    document.getElementById("authModal").classList.add("hidden");
    document.getElementById("roleModal").classList.remove("hidden");
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

    if (currentRole === "ngo") {
        label.textContent = "NGO / ORGANIZATION";
        nameLabel.textContent = "Organization / NGO Name";
    } else {
        label.textContent = "FOOD DONOR";
        nameLabel.textContent = "Your Name / Organization";
    }

    switchAuth(authMode);
}

function switchAuth(mode) {
    authMode = mode;

    const title = document.getElementById("authTitle");
    const subtitle = document.getElementById("authSubtitle");
    const nameField = document.getElementById("nameField");
    const signupTab = document.getElementById("signupTab");
    const loginTab = document.getElementById("loginTab");

    if (mode === "signup") {
        title.textContent = "Create your account";
        subtitle.textContent = "Join ShareBite and start making an impact.";
        nameField.classList.remove("hidden");
        signupTab.classList.add("active");
        loginTab.classList.remove("active");
    } else {
        title.textContent = "Welcome back";
        subtitle.textContent = "Login to continue to your dashboard.";
        nameField.classList.add("hidden");
        signupTab.classList.remove("active");
        loginTab.classList.add("active");
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

function initFormDates() {
    const today = new Date().toISOString().split("T")[0];
    const preparedInput = document.getElementById("preparedDate");
    const expiryInput = document.getElementById("expiryDate");

    if (preparedInput) {
        if (!preparedInput.value) preparedInput.value = today;
        preparedInput.max = today;
    }
    if (expiryInput) {
        expiryInput.min = today;
    }
}

function resetDonationForm() {
    const form = document.getElementById("donationForm");
    if (form) form.reset();
    removeImage();

    const badge = document.getElementById("priorityBadge");
    const text = document.getElementById("priorityText");
    if (badge) {
        badge.className = "priority-badge";
        badge.textContent = "Not analyzed";
    }
    if (text) {
        text.textContent = "Complete the form to calculate priority.";
    }

    initFormDates();
}

function setupDonationForm() {
    const form = document.getElementById("donationForm");
    if (!form) return;

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!currentUser) {
            showToast("Please login first.");
            return;
        }

        const foodName = document.getElementById("foodName").value.trim();
        const foodType = document.getElementById("foodType").value;
        const quantity = Number(document.getElementById("foodQuantity").value);
        const preparedDate = document.getElementById("preparedDate").value;
        const expiryDate = document.getElementById("expiryDate").value;
        const pickupLocation = document.getElementById("pickupLocation").value.trim();
        const description = document.getElementById("foodDescription").value.trim();

        if (!foodName || !foodType || !quantity || !preparedDate || !expiryDate || !pickupLocation) {
            showToast("Please complete all required fields.");
            return;
        }

        if (quantity <= 0 || isNaN(quantity)) {
            showToast("Please enter a valid positive quantity.");
            return;
        }

        if (new Date(expiryDate) < new Date(preparedDate)) {
            showToast("Expiry date cannot be before prepared date.");
            return;
        }

        // STRICT MANDATORY FOOD IMAGE & REAL AI VERIFICATION
        if (!uploadedImageBase64) {
            showToast("❌ Uploading a food image is mandatory! Please upload a photo of the food you want to donate.");
            const uploadBox = document.getElementById("foodUploadBox");
            if (uploadBox) {
                uploadBox.classList.add("has-error");
                uploadBox.scrollIntoView({ behavior: "smooth", block: "center" });
                setTimeout(() => uploadBox.classList.remove("has-error"), 1500);
            }
            return;
        }

        if (isAnalyzingImage) {
            showToast("⏳ Real AI is currently analyzing your food image. Please wait a moment...");
            return;
        }

        if (!lastAIVerifiedStatus || !lastAIVerifiedStatus.isFood || !lastAIVerifiedStatus.isSafeForDonation) {
            showToast("❌ Image verification required: You must upload an image verified as genuine, safe food by Real AI.");
            const uploadBox = document.getElementById("foodUploadBox");
            if (uploadBox) {
                uploadBox.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            return;
        }

        const priority = calculatePriority(expiryDate, quantity, preparedDate);
        const image = uploadedImageBase64;

        const payload = {
            foodName,
            foodType,
            quantity,
            preparedDate,
            expiryDate,
            pickupLocation,
            description,
            image,
            priority: priority === "Expired" ? "Low" : priority
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


/* ================= PRIORITY CALCULATION ================= */

function calculatePriority(expiryDate, quantity, preparedDate = null) {
    if (!expiryDate) return "Low";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const parts = expiryDate.split("-");
    const expiry = new Date(parts[0], parts[1] - 1, parts[2]);
    expiry.setHours(23, 59, 59, 999);

    const diffMs = expiry.getTime() - today.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const qty = Number(quantity) || 0;

    if (days < 0) {
        return "Expired";
    }

    if (days <= 1 || (days <= 2 && qty >= 15)) {
        return "High";
    }

    if (days <= 3) {
        return "Medium";
    }

    return "Low";
}

function updatePriorityPreview() {
    const expiry = document.getElementById("expiryDate")?.value;
    const quantity = Number(document.getElementById("foodQuantity")?.value || 0);
    const prepared = document.getElementById("preparedDate")?.value;

    const badge = document.getElementById("priorityBadge");
    const text = document.getElementById("priorityText");

    if (!badge || !text) return;

    if (!expiry) {
        badge.className = "priority-badge";
        badge.textContent = "Not analyzed";
        text.textContent = "Complete the form to calculate priority.";
        return;
    }

    if (prepared && expiry && new Date(expiry) < new Date(prepared)) {
        badge.className = "priority-badge high";
        badge.textContent = "INVALID DATES";
        text.textContent = "Expiry date cannot be earlier than prepared date.";
        return;
    }

    const priority = calculatePriority(expiry, quantity, prepared);
    badge.className = "priority-badge";

    if (priority === "Expired") {
        badge.classList.add("high");
        badge.textContent = "EXPIRED";
        text.textContent = "Warning: Selected expiry date is in the past.";
    } else if (priority === "High") {
        badge.classList.add("high");
        badge.textContent = "HIGH PRIORITY";
        text.textContent = "Urgent: Short shelf-life or high volume. Fast collection recommended.";
    } else if (priority === "Medium") {
        badge.classList.add("medium");
        badge.textContent = "MEDIUM PRIORITY";
        text.textContent = "Moderate urgency: Arrange collection within 2-3 days.";
    } else {
        badge.classList.add("low");
        badge.textContent = "LOW PRIORITY";
        text.textContent = "Normal collection window: Shelf-life permits standard scheduling.";
    }
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

        if (!file.type.startsWith("image/")) {
            showToast("Please select a valid image file (JPG, PNG, WebP).");
            this.value = "";
            return;
        }

        try {
            const compressed = await compressImageFile(file);
            uploadedImageBase64 = compressed;
            lastAIVerifiedStatus = null;

            const previewImg = document.getElementById("imagePreview");
            const container = document.getElementById("imagePreviewContainer");
            const overlay = document.getElementById("imageVerificationOverlay");
            const alertEl = document.getElementById("aiRejectionAlert");
            const reqBadge = document.getElementById("foodImageRequirementBadge");

            if (alertEl) alertEl.classList.add("hidden");
            if (previewImg) {
                previewImg.src = compressed;
                previewImg.className = "food-preview verifying";
            }
            if (overlay) {
                overlay.className = "image-verification-overlay verifying";
                overlay.innerHTML = "⏳ AI Vision Inspecting...";
                overlay.classList.remove("hidden");
            }
            if (container) container.classList.remove("hidden");
            if (reqBadge) {
                reqBadge.className = "status pending";
                reqBadge.textContent = "AI Verifying...";
            }

            // Auto-trigger Real AI Vision Analysis upon upload
            await triggerAIVisionAnalysis();
        } catch (err) {
            console.error("Image compression error:", err);
            showToast("Could not process the selected image.");
        }
    });
}

function removeImage() {
    uploadedImageBase64 = null;
    latestAISuggestions = null;
    lastAIVerifiedStatus = null;

    const input = document.getElementById("foodImage");
    const previewContainer = document.getElementById("imagePreviewContainer");
    const previewImg = document.getElementById("imagePreview");
    const overlay = document.getElementById("imageVerificationOverlay");
    const aiCard = document.getElementById("aiAnalysisCard");
    const alertEl = document.getElementById("aiRejectionAlert");
    const reqBadge = document.getElementById("foodImageRequirementBadge");

    if (input) input.value = "";
    if (previewImg) {
        previewImg.src = "";
        previewImg.className = "food-preview";
    }
    if (overlay) {
        overlay.classList.add("hidden");
        overlay.innerHTML = "";
    }
    if (previewContainer) previewContainer.classList.add("hidden");
    if (aiCard) aiCard.classList.add("hidden");
    if (alertEl) alertEl.classList.add("hidden");
    if (reqBadge) {
        reqBadge.className = "status pending";
        reqBadge.textContent = "Upload Required";
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
                <span>Inspecting food image with Google Gemini Vision model...</span>
            </div>
        `;
    }

    try {
        showToast("Inspecting photo with Real AI Vision... 🤖");
        const analysis = await API.post("/ai/analyze-image", { image: uploadedImageBase64 });
        latestAISuggestions = analysis;

        // -------------------------------------------------------------
        // STRICT NON-FOOD REJECTION
        // -------------------------------------------------------------
        if (!analysis.isFood) {
            lastAIVerifiedStatus = { isFood: false, isSafeForDonation: false };
            uploadedImageBase64 = null; // Clear base64 so non-food CANNOT be submitted

            const input = document.getElementById("foodImage");
            if (input) input.value = "";

            if (previewImg) previewImg.className = "food-preview rejected";
            if (overlay) {
                overlay.className = "image-verification-overlay rejected";
                overlay.innerHTML = "🚫 REJECTED: Not Food";
                overlay.classList.remove("hidden");
            }
            if (reqBadge) {
                reqBadge.className = "status expired";
                reqBadge.textContent = "Rejected (Not Food)";
            }

            const msgEl = document.getElementById("aiRejectionMessage");
            const badgeEl = document.getElementById("aiRejectionBadge");
            if (msgEl) {
                msgEl.textContent = analysis.rejectionReason || "This photo does not depict edible food or groceries. ShareBite requires a genuine food photo for every donation.";
            }
            if (badgeEl) {
                badgeEl.textContent = "Non-Food Rejected";
            }
            if (alertEl) {
                alertEl.classList.remove("hidden");
                alertEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
            if (card) card.classList.add("hidden");

            showToast("❌ Image Rejected by AI: " + (analysis.rejectionReason || "Not a food image!"));
            return;
        }

        // -------------------------------------------------------------
        // FOOD SAFETY / SPOILAGE REJECTION
        // -------------------------------------------------------------
        if (analysis.isFood && !analysis.isSafeForDonation) {
            lastAIVerifiedStatus = { isFood: true, isSafeForDonation: false };
            uploadedImageBase64 = null; // Clear base64 so unsafe food CANNOT be submitted

            const input = document.getElementById("foodImage");
            if (input) input.value = "";

            if (previewImg) previewImg.className = "food-preview rejected";
            if (overlay) {
                overlay.className = "image-verification-overlay rejected";
                overlay.innerHTML = "⚠️ REJECTED: Unsafe Food";
                overlay.classList.remove("hidden");
            }
            if (reqBadge) {
                reqBadge.className = "status expired";
                reqBadge.textContent = "Rejected (Unsafe)";
            }

            const msgEl = document.getElementById("aiRejectionMessage");
            const badgeEl = document.getElementById("aiRejectionBadge");
            if (msgEl) {
                msgEl.textContent = analysis.safetyWarning || analysis.rejectionReason || "Food appears spoiled, decomposing, or unsafe for donation. To protect community health, only fresh food can be shared.";
            }
            if (badgeEl) {
                badgeEl.textContent = "Unsafe / Spoiled";
            }
            if (alertEl) {
                alertEl.classList.remove("hidden");
                alertEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
            if (card) card.classList.add("hidden");

            showToast("⚠️ Image Rejected: Food appears spoiled or unsafe for donation.");
            return;
        }

        // -------------------------------------------------------------
        // VERIFIED REAL & SAFE FOOD
        // -------------------------------------------------------------
        lastAIVerifiedStatus = { isFood: true, isSafeForDonation: true, foodName: analysis.foodName };

        if (previewImg) previewImg.className = "food-preview verified";
        if (overlay) {
            overlay.className = "image-verification-overlay verified";
            overlay.innerHTML = `✅ AI Verified: ${escapeHTML(analysis.foodName || 'Food Approved')}`;
            overlay.classList.remove("hidden");
        }
        if (reqBadge) {
            reqBadge.className = "status accepted";
            reqBadge.textContent = "✅ AI Verified";
        }
        if (alertEl) alertEl.classList.add("hidden");

        if (modelBadge) {
            modelBadge.textContent = analysis.aiProvider || "Google Gemini Multimodal Vision AI";
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
                    <div><strong>🛡️ Safe for Donation:</strong> <span style="color:var(--green);font-weight:700;">✅ Verified Safe</span></div>
                    <div><strong>⚡ Urgency Priority:</strong> <span class="priority-text-${(analysis.priority || 'medium').toLowerCase()}">${analysis.priority}</span></div>
                    <div><strong>📅 Shelf-life estimate:</strong> ~${analysis.suggestedExpiryDays || 2} days</div>
                </div>
                <div style="background:rgba(255,255,255,0.8);padding:8px 12px;border-radius:8px;border-left:3px solid var(--green);">
                    <strong>AI Visual Inspection Notes:</strong> ${escapeHTML(analysis.description)}
                </div>
            `;
        }

        showToast(`✅ Real Food Verified: "${analysis.foodName}"! Click 'Auto-Fill Form' to apply AI suggestions. ✨`);
    } catch (err) {
        console.error("AI analysis error:", err);
        const errMsg = err.message || "";

        if (errMsg.includes("API_KEY") || errMsg.includes("Key Required") || errMsg.includes("API key")) {
            showToast("⚠️ Gemini API key is not configured in .env file.");
            if (overlay) {
                overlay.className = "image-verification-overlay rejected";
                overlay.innerHTML = "⚠️ API Key Needed in .env";
            }
            if (reqBadge) {
                reqBadge.className = "status expired";
                reqBadge.textContent = "API Key Needed";
            }
        } else {
            showToast("AI analysis error: " + errMsg);
            if (overlay) {
                overlay.className = "image-verification-overlay rejected";
                overlay.innerHTML = "⚠️ Inspection Error";
            }
            if (reqBadge) {
                reqBadge.className = "status expired";
                reqBadge.textContent = "Verification Failed";
            }
        }

        if (resultsEl) {
            resultsEl.innerHTML = `<span style="color:var(--danger)">Error inspecting image with Real AI: ${escapeHTML(errMsg)}</span>`;
        }
    } finally {
        isAnalyzingImage = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText || `✨ Analyze & Verify with Real AI`;
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

    let available = donations.filter(donation => {
        if (donation.status !== "Available") return false;

        const nameMatch = (donation.foodName || "").toLowerCase().includes(search);
        const locMatch = (donation.pickupLocation || "").toLowerCase().includes(search);
        const descMatch = (donation.description || "").toLowerCase().includes(search);
        const typeMatch = (donation.foodType || "").toLowerCase().includes(search);
        const matchesSearch = !search || nameMatch || locMatch || descMatch || typeMatch;

        const matchesFilter = !filter || donation.foodType === filter;

        return matchesSearch && matchesFilter;
    });

    // Sorting
    if (sort === "priority") {
        const weight = { "High": 3, "Medium": 2, "Low": 1 };
        available.sort((a, b) => (weight[b.priority] || 0) - (weight[a.priority] || 0));
    } else if (sort === "quantity") {
        available.sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0));
    } else if (sort === "newest") {
        available.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    if (available.length === 0) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = available.map(donation => ngoFoodItem(donation)).join("");
}

function renderNGORecentFood() {
    const container = document.getElementById("ngoRecentFood");
    if (!container) return;

    const available = donations.filter(
        donation => donation.status === "Available"
    ).slice(0, 3);

    if (available.length === 0) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = available.map(donation => `
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
                    <span class="status pending">Available</span>
                </div>

                <div class="meta-row">
                    <span>Quantity</span>
                    <strong>${donation.quantity} kg</strong>
                </div>
                <div class="meta-row">
                    <span>Priority</span>
                    <strong class="priority-text-${donation.priority.toLowerCase()}">${donation.priority}</strong>
                </div>
                <div class="meta-row">
                    <span>Location</span>
                    <span>${escapeHTML(donation.pickupLocation)}</span>
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
    `).join("");
}

function ngoFoodItem(donation) {
    const priorityClass = donation.priority === "High" ? "pending" : "";

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
                    <p>
                        ${escapeHTML(donation.foodType)} •
                        ${donation.quantity} kg •
                        Donor: ${escapeHTML(donation.donorName || "Community Member")}
                    </p>
                    <p>📍 ${escapeHTML(donation.pickupLocation)}</p>
                    <p>⏰ Best before: ${formatDate(donation.expiryDate)}</p>
                </div>
            </div>

            <div class="food-actions">
                <span class="status ${priorityClass}">
                    ${donation.priority} Priority
                </span>
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

    container.innerHTML = `
        <div class="food-detail-header">
            <span class="eyebrow">${escapeHTML(donation.foodType)}</span>
            <h2>${escapeHTML(donation.foodName)}</h2>
            <div class="food-detail-badges">
                <span class="status ${getStatusClass(donation.status)}">${escapeHTML(donation.status)}</span>
                <span class="priority-badge ${donation.priority ? donation.priority.toLowerCase() : 'low'}">${donation.priority || 'Standard'} Priority</span>
            </div>
        </div>

        <div class="food-detail-image-wrap">
            <img src="${escapeHTML(donation.image)}" alt="${escapeHTML(donation.foodName)}" class="food-detail-image">
        </div>

        <div class="food-detail-grid">
            <div class="detail-cell">
                <span class="detail-label">Quantity</span>
                <strong class="detail-val">${donation.quantity} kg (~${Math.round(donation.quantity * 4)} meals)</strong>
            </div>
            <div class="detail-cell">
                <span class="detail-label">Pickup Location</span>
                <strong class="detail-val">📍 ${escapeHTML(donation.pickupLocation)}</strong>
            </div>
            <div class="detail-cell">
                <span class="detail-label">Prepared Date</span>
                <strong class="detail-val">📅 ${formatDate(donation.preparedDate)}</strong>
            </div>
            <div class="detail-cell">
                <span class="detail-label">Best Before</span>
                <strong class="detail-val">⏰ ${formatDate(donation.expiryDate)}</strong>
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
            ${isNGO && donation.status === "Available" ? `
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
    const parts = dateString.split("-");
    if (parts.length === 3) {
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        return d.toLocaleDateString("en-US", {
            day: "numeric",
            month: "short",
            year: "numeric"
        });
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric"
    });
}

function escapeHTML(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}