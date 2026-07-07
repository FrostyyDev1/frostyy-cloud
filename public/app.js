const state = {
  user: null,
  view: 'landing',
  files: [],
  selectedIds: new Set(),
  currentFolder: null,
  theme: 'dark',
  modal: null,
  loading: false,
  message: '',
  error: '',
  showGrid: true,
  sortBy: 'date',
  filterType: 'all',
  search: '',
  uploadProgress: 0,
  dragActive: false,
  currentPage: 1,
  pageSize: 12,
  maxFileSizeMb: 20,
  storageQuotaMb: 5120,
  themePreference: 'dark',
  adminUsersRaw: [],
  adminUsersSearch: '',
  dashboardLoaded: false,
  resetToken: ''
};

const els = {};

function init() {
  bindElements();
  bindEvents();
  bindGlobalSearch();
  applyTheme();
  // A ?resetToken=... link (from the server log) opens the reset-password
  // panel once the session check settles. Strip it from the URL so a refresh
  // doesn't re-trigger the panel or leave the token in browser history.
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('resetToken')) {
    state.resetToken = urlParams.get('resetToken');
    urlParams.delete('resetToken');
    const query = urlParams.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
  }
  startSplashTimeout();
  loadAppConfig();
  loadUser();
  updateViewToggleButtons();
  render();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.themePreference === 'system') applyTheme();
  });
}

/* ---- Splash loader ----------------------------------------------------
   Full-screen branded loader shown on first load. It overlays everything
   until the session check (loadUser) settles, so users never see a flash
   of the landing page or login form before the right screen is known. */

let splashHidden = false;
let splashTimeoutId = null;
let splashShownAt = Date.now();

// Safety net: never leave the splash stuck if something hangs.
const SPLASH_MAX_WAIT_MS = 10000;

// Keep the splash visible long enough to actually be seen. Session checks on a
// local server resolve in a few ms, which used to make the splash invisible.
// ?splashTest=1 stretches it to 2s so the animation can be reviewed visually —
// harmless if a user types it in production, it only delays paint slightly.
const SPLASH_MIN_MS = new URLSearchParams(window.location.search).has('splashTest') ? 2000 : 700;

function startSplashTimeout() {
  clearTimeout(splashTimeoutId);
  splashTimeoutId = setTimeout(hideSplash, SPLASH_MAX_WAIT_MS);
}

function hideSplash() {
  if (splashHidden) return;
  splashHidden = true;
  clearTimeout(splashTimeoutId);
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  const remaining = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt));
  setTimeout(() => {
    splash.classList.add('splash-hide');
    setTimeout(() => splash.classList.add('hidden'), 450);
  }, remaining);
}

function showSplashError() {
  if (splashHidden) return false;
  const splash = document.getElementById('splash-screen');
  if (!splash) return false;
  clearTimeout(splashTimeoutId);
  splash.classList.add('has-error');
  return true;
}

async function retrySplashLoad() {
  document.getElementById('splash-screen')?.classList.remove('has-error');
  splashShownAt = Date.now();
  startSplashTimeout();
  await loadUser();
}

function getSystemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  state.theme = state.themePreference === 'system' ? getSystemTheme() : state.themePreference;
  document.body.dataset.theme = state.theme;
  const themeIcon = document.getElementById('theme-toggle');
  if (themeIcon) themeIcon.innerHTML = svgIcon(state.theme === 'dark' ? 'i-sun' : 'i-moon');
  document.querySelectorAll('.theme-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeChoice === state.themePreference);
  });
}

function setThemePreference(pref) {
  state.themePreference = pref;
  applyTheme();
  if (state.user) {
    sendJson('/api/auth/profile', { theme: pref }, 'PUT');
  }
}

function updateViewToggleButtons() {
  els.viewToggleGrid?.classList.toggle('active', state.showGrid);
  els.viewToggleList?.classList.toggle('active', !state.showGrid);
}

function bindElements() {
  els.app = document.getElementById('app');
  els.authScreen = document.getElementById('auth-screen');
  els.landingScreen = document.getElementById('landing-screen');
  els.dashboardShell = document.getElementById('dashboard-shell');
  els.mainContent = document.getElementById('main-content');
  els.viewTitle = document.getElementById('topbar-title');
  els.topbarTitle = document.getElementById('topbar-title');
  els.userName = document.getElementById('user-name');
  els.authForm = document.getElementById('auth-form');
  els.authTitle = document.getElementById('auth-title');
  els.authSwitch = document.getElementById('auth-switch');
  els.authMessage = document.getElementById('auth-message');
  els.authError = document.getElementById('auth-error');
  els.authEmail = document.getElementById('auth-email');
  els.authPassword = document.getElementById('auth-password');
  els.authConfirmPassword = document.getElementById('auth-confirm-password');
  els.authSubmit = document.getElementById('auth-submit');
  els.createFolderBtn = document.getElementById('create-folder-btn');
  els.uploadBtn = document.getElementById('upload-btn');
  els.uploadInput = document.getElementById('upload-input');
  els.fileList = document.getElementById('file-list');
  els.dashboardPage = document.getElementById('dashboard-page');
  els.filesPage = document.getElementById('files-page');
  els.sharedPage = document.getElementById('shared-page');
  els.uploadsPage = document.getElementById('uploads-page');
  els.storagePage = document.getElementById('storage-page');
  els.settingsPage = document.getElementById('settings-page');
  els.supportPage = document.getElementById('support-page');
  els.activityPage = document.getElementById('activity-page');
  els.adminPage = document.getElementById('admin-page');
  els.adminUsersSearch = document.getElementById('admin-users-search');
  els.globalSearchInput = document.getElementById('global-search-input');
  els.sortSelect = document.getElementById('sort-select');
  els.filterSelect = document.getElementById('filter-select');
  els.messageBox = document.getElementById('message-box');
  els.errorBox = document.getElementById('error-box');
  els.loadingBox = document.getElementById('loading-box');
  els.recentUploads = document.getElementById('recent-uploads');
  els.sharedList = document.getElementById('shared-list');
  els.activityList = document.getElementById('activity-list');
  els.supportForm = document.getElementById('support-form');
  els.settingsForm = document.getElementById('settings-form');
  els.themeToggle = document.getElementById('theme-toggle');
  els.passwordForm = document.getElementById('password-form');
  els.deleteAccountBtn = document.getElementById('delete-account-btn');
  els.modalBackdrop = document.getElementById('modal-backdrop');
  els.modalTitle = document.getElementById('modal-title');
  els.modalBody = document.getElementById('modal-body');
  els.modalConfirm = document.getElementById('modal-confirm');
  els.previewModal = document.getElementById('preview-modal');
  els.previewFrame = document.getElementById('preview-frame');
  els.progressBar = document.getElementById('upload-progress');
  els.progressText = document.getElementById('upload-progress-text');
  els.dropzone = document.getElementById('dropzone');
  els.viewToggleList = document.getElementById('view-toggle-list');
  els.viewToggleGrid = document.getElementById('view-toggle-grid');
  els.breadcrumb = document.getElementById('breadcrumb');
  els.bulkActions = document.getElementById('bulk-actions');
  els.selectAllCheckbox = document.getElementById('select-all-checkbox');
  els.selectionCount = document.getElementById('selection-count');
  els.pagination = document.getElementById('pagination');
  els.recentFileList = document.getElementById('recent-file-list');
  els.favoritesFileList = document.getElementById('favorites-file-list');
  els.trashFileList = document.getElementById('trash-file-list');
  els.sidebarStorageUsed = document.getElementById('sidebar-storage-used');
  els.sidebarStorageTotal = document.getElementById('sidebar-storage-total');
  els.sidebarStorageBar = document.getElementById('sidebar-storage-bar');
  els.sidebarUserName = document.getElementById('sidebar-user-name');
  els.sidebarUserEmail = document.getElementById('sidebar-user-email');
  els.sidebarUserAvatar = document.getElementById('sidebar-user-avatar');
  els.topbarUserAvatar = document.getElementById('topbar-user-avatar');
  els.profileMenu = document.getElementById('profile-menu');
  els.topbarProfileMenu = document.getElementById('topbar-profile-menu');
}

function bindEvents() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.nav));
  });

  const loginCta = document.getElementById('login-cta');
  const signupCta = document.getElementById('signup-cta');
  const logoutNav = document.getElementById('logout-nav');
  const logoutTopbar = document.getElementById('logout-topbar');

  if (loginCta) loginCta.addEventListener('click', () => showAuth('login'));
  if (signupCta) signupCta.addEventListener('click', () => showAuth('signup'));
  if (logoutNav) logoutNav.addEventListener('click', logout);
  if (logoutTopbar) logoutTopbar.addEventListener('click', logout);
  document.getElementById('auth-form').addEventListener('submit', handleAuthSubmit);
  document.getElementById('create-folder-btn').addEventListener('click', createFolder);
  document.getElementById('upload-btn').addEventListener('click', () => els.uploadInput.click());
  els.uploadInput.addEventListener('change', () => uploadFiles(els.uploadInput.files));
  if (els.supportForm) els.supportForm.addEventListener('submit', submitSupport);
  if (els.settingsForm) els.settingsForm.addEventListener('submit', submitSettings);
  if (els.passwordForm) els.passwordForm.addEventListener('submit', submitPassword);
  if (els.deleteAccountBtn) els.deleteAccountBtn.addEventListener('click', () => openModal('Account deletion', 'This demo build does not delete accounts. It only records the request.', () => {}));
  if (els.modalConfirm) els.modalConfirm.addEventListener('click', handleModalConfirm);
  const splashRetry = document.getElementById('splash-retry');
  if (splashRetry) splashRetry.addEventListener('click', () => withBusyButton(splashRetry, 'Retrying…', retrySplashLoad));

  document.getElementById('auth-forgot-link')?.addEventListener('click', showForgotPassword);
  document.getElementById('forgot-back-link')?.addEventListener('click', () => showAuth('login'));
  document.getElementById('reset-back-link')?.addEventListener('click', () => showAuth('login'));
  document.getElementById('forgot-form')?.addEventListener('submit', handleForgotSubmit);
  document.getElementById('reset-form')?.addEventListener('submit', handleResetSubmit);
  const modalClose = document.getElementById('modal-close');
  if (modalClose) modalClose.addEventListener('click', closeModal);

  if (els.dropzone) {
    const selectBtn = els.dropzone.querySelector('.dropzone-select-btn');
    els.dropzone.addEventListener('click', () => els.uploadInput.click());
    selectBtn?.addEventListener('click', (e) => { e.stopPropagation(); els.uploadInput.click(); });
    els.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); state.dragActive = true; els.dropzone.classList.add('dragging'); });
    els.dropzone.addEventListener('dragleave', () => { state.dragActive = false; els.dropzone.classList.remove('dragging'); });
    els.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      state.dragActive = false;
      els.dropzone.classList.remove('dragging');
      uploadFiles(e.dataTransfer.files);
    });
  }

  if (els.adminUsersSearch) els.adminUsersSearch.addEventListener('input', (e) => { state.adminUsersSearch = e.target.value; renderAdminUsersFiltered(); });
  if (els.sortSelect) els.sortSelect.addEventListener('change', (e) => { state.sortBy = e.target.value; renderFiles(); });
  if (els.filterSelect) els.filterSelect.addEventListener('change', (e) => { state.filterType = e.target.value; state.currentPage = 1; renderFiles(); });
  els.viewToggleGrid?.addEventListener('click', () => { state.showGrid = true; state.currentPage = 1; renderFiles(); updateViewToggleButtons(); });
  els.viewToggleList?.addEventListener('click', () => { state.showGrid = false; state.currentPage = 1; renderFiles(); updateViewToggleButtons(); });

  const bulkDeleteBtn = document.getElementById('bulk-delete');
  if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', bulkDelete);
  const bulkShareBtn = document.getElementById('bulk-share');
  if (bulkShareBtn) bulkShareBtn.addEventListener('click', bulkShare);
  const bulkDownloadBtn = document.getElementById('bulk-download');
  if (bulkDownloadBtn) bulkDownloadBtn.addEventListener('click', bulkDownload);
  const bulkMoveBtn = document.getElementById('bulk-move');
  if (bulkMoveBtn) bulkMoveBtn.addEventListener('click', bulkMove);
  const bulkClearBtn = document.getElementById('bulk-clear');
  if (bulkClearBtn) bulkClearBtn.addEventListener('click', clearSelection);
  if (els.selectAllCheckbox) els.selectAllCheckbox.addEventListener('change', toggleSelectAll);

  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

  const topbarUploadBtn = document.getElementById('topbar-upload-btn');
  if (topbarUploadBtn) topbarUploadBtn.addEventListener('click', () => els.uploadInput.click());
  const topbarNewFolderBtn = document.getElementById('topbar-new-folder-btn');
  if (topbarNewFolderBtn) topbarNewFolderBtn.addEventListener('click', createFolder);

  const emptyTrashBtn = document.getElementById('empty-trash-btn');
  if (emptyTrashBtn) emptyTrashBtn.addEventListener('click', emptyTrash);

  document.querySelectorAll('.theme-option').forEach((btn) => {
    btn.addEventListener('click', () => setThemePreference(btn.dataset.themeChoice));
  });

  const moveModal = document.getElementById('move-modal');
  const moveModalClose = document.getElementById('move-modal-close');
  if (moveModalClose) moveModalClose.addEventListener('click', () => moveModal.classList.add('hidden'));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.add('hidden');
    });
  });

  bindDropdown(document.getElementById('profile-menu-btn'), els.profileMenu);
  bindDropdown(document.getElementById('topbar-avatar-btn'), els.topbarProfileMenu);

  // Ctrl+K / Cmd+K focuses the global search (the topbar advertises this).
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.user) {
      e.preventDefault();
      els.globalSearchInput?.focus();
    }
  });

  document.querySelectorAll('[data-auth]').forEach((btn) => {
    btn.addEventListener('click', () => showAuth(btn.dataset.auth === 'signup' ? 'signup' : 'login'));
  });

  document.querySelectorAll('.auth-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => showAuth(btn.dataset.authMode));
  });

  const passwordToggle = document.getElementById('auth-password-toggle');
  if (passwordToggle) passwordToggle.addEventListener('click', () => {
    const isPassword = els.authPassword.type === 'password';
    els.authPassword.type = isPassword ? 'text' : 'password';
    passwordToggle.innerHTML = svgIcon(isPassword ? 'i-eye-off' : 'i-eye');
    passwordToggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  });

  const authBack = document.getElementById('auth-back');
  if (authBack) authBack.addEventListener('click', () => {
    state.view = 'landing';
    resetAuthForm();
    els.authScreen.classList.add('hidden');
    els.landingScreen.classList.remove('hidden');
  });

  const sidebarEl = document.querySelector('.sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const closeSidebar = () => {
    if (sidebarEl) sidebarEl.classList.remove('open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('visible');
  };
  if (sidebarToggle) sidebarToggle.addEventListener('click', () => {
    if (sidebarEl) sidebarEl.classList.toggle('open');
    if (sidebarOverlay) sidebarOverlay.classList.toggle('visible', sidebarEl?.classList.contains('open'));
  });
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);
  document.querySelectorAll('.sidebar .nav-item').forEach((btn) => btn.addEventListener('click', closeSidebar));
}

function bindDropdown(trigger, menu) {
  if (!trigger || !menu) return;
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = menu.classList.contains('hidden');
    document.querySelectorAll('.profile-menu').forEach((m) => m.classList.add('hidden'));
    if (willOpen) menu.classList.remove('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== trigger) menu.classList.add('hidden');
  });
}

let searchDebounceTimer = null;

function bindGlobalSearch() {
  if (!els.globalSearchInput) return;
  const resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;
  els.globalSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchDebounceTimer);
    if (!query) {
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      return;
    }
    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = '<div class="search-loading">Searching…</div>';
    searchDebounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        renderSearchResults(resultsEl, data.items || []);
      } catch {
        resultsEl.innerHTML = '<div class="search-empty">Search failed. Try again.</div>';
      }
    }, 250);
  });
  document.addEventListener('click', (e) => {
    if (!resultsEl.contains(e.target) && e.target !== els.globalSearchInput) {
      resultsEl.classList.add('hidden');
    }
  });
}

function renderSearchResults(container, items) {
  if (!items.length) {
    container.innerHTML = '<div class="search-empty">No matches found.</div>';
    return;
  }
  container.innerHTML = items.map((item) => `
    <button class="search-result-row" data-result-id="${item.id}" data-result-parent="${item.parentId ?? ''}" data-result-type="${item.type}">
      <span class="file-icon">${getFileVisual(item, 'sm')}</span>
      <span class="search-result-meta"><strong>${escapeHtml(item.displayName || item.name)}</strong><span>${escapeHtml(item.location || 'Home')}</span></span>
    </button>
  `).join('');
  container.querySelectorAll('[data-result-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.classList.add('hidden');
      els.globalSearchInput.value = '';
      const targetFolder = btn.dataset.resultType === 'folder' ? btn.dataset.resultId : (btn.dataset.resultParent || null);
      state.currentFolder = targetFolder || null;
      state.currentPage = 1;
      state.search = '';
      switchView('files');
    });
  });
}

function showMessage(message) {
  state.message = message;
  state.error = '';
  render();
  setTimeout(() => { if (state.message === message) { state.message = ''; render(); } }, 2500);
}

function showError(message) {
  state.error = message;
  render();
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function applyUserChrome() {
  if (!state.user) return;
  const label = state.user.displayName || state.user.username;
  const initials = getInitials(label);
  if (els.userName) els.userName.innerText = label;
  if (els.sidebarUserName) els.sidebarUserName.innerText = label;
  if (els.sidebarUserEmail) els.sidebarUserEmail.innerText = state.user.email || state.user.username;
  if (els.sidebarUserAvatar) els.sidebarUserAvatar.innerText = initials;
  if (els.topbarUserAvatar) els.topbarUserAvatar.innerText = initials;
  const adminNav = document.querySelector('[data-nav="admin"]');
  const adminLabel = document.getElementById('admin-nav-label');
  const isAdmin = !!state.user.isAdmin;
  if (adminNav) adminNav.classList.toggle('hidden', !isAdmin);
  if (adminLabel) adminLabel.classList.toggle('hidden', !isAdmin);
  const adminBadge = document.getElementById('settings-admin-badge');
  if (adminBadge) adminBadge.classList.toggle('hidden', !isAdmin);
}

function isUnlimitedQuota(quotaMb) {
  return quotaMb === -1;
}

/** Computes display-ready values for a quota bar/label, handling the
 * unlimited (-1) sentinel cleanly instead of producing broken percentages. */
function computeQuotaDisplay(totalSize, quotaMb) {
  if (isUnlimitedQuota(quotaMb)) {
    return { percent: 100, isUnlimited: true, totalLabel: 'Unlimited' };
  }
  const quotaBytes = quotaMb * 1024 * 1024;
  const percent = Math.min(100, Math.round((totalSize / quotaBytes) * 100));
  return { percent, isUnlimited: false, totalLabel: formatGb(quotaBytes) };
}

function applyQuotaBar(barEl, totalSize, quotaMb) {
  if (!barEl) return;
  const q = computeQuotaDisplay(totalSize, quotaMb);
  barEl.style.width = `${q.percent}%`;
  barEl.parentElement?.classList.toggle('is-unlimited', q.isUnlimited);
  return q;
}

function updateSidebarStorage(totalSize, quotaMb) {
  const q = applyQuotaBar(els.sidebarStorageBar, totalSize, quotaMb);
  if (els.sidebarStorageUsed) els.sidebarStorageUsed.innerText = formatBytes(totalSize);
  if (els.sidebarStorageTotal) els.sidebarStorageTotal.innerText = q.totalLabel;
}

function formatGb(bytes) {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

async function loadAppConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (!res.ok) return;
    state.appConfig = data;
    document.getElementById('maintenance-banner')?.classList.toggle('hidden', !data.maintenanceMode);
    const aboutVersion = document.getElementById('about-version');
    const aboutMode = document.getElementById('about-registration-mode');
    if (aboutVersion) aboutVersion.innerText = data.version;
    if (aboutMode) aboutMode.innerText = `Registration: ${data.registrationMode}`;
  } catch {
    // ignore - app still works without config info
  }
}

/** Sends `body` as JSON and parses the JSON response. Never throws on bad JSON. */
async function sendJson(url, body, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/** Handles a 401 from a background loader without a scary red toast.
 * Returns true when the response was an auth failure (already handled):
 * a signed-in user is calmly sent to the login card with a session-expired
 * note; parallel loaders hitting the same 401 become no-ops. */
function handleAuthLoss(res) {
  if (res.status !== 401) return false;
  if (!state.user) return true;
  state.user = null;
  state.files = [];
  state.shared = [];
  state.adminUsersRaw = [];
  state.dashboardLoaded = false;
  showAuth('login');
  els.authMessage.innerText = 'Your session expired. Please sign in again.';
  render();
  return true;
}

async function loadUser() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      // No session is a normal state on first visit - show the landing page
      // (or the reset panel if the user arrived via a reset link), silently.
      state.user = null;
      if (state.resetToken) {
        showResetPanel();
      } else {
        switchView('landing');
      }
      hideSplash();
      return;
    }
    const data = await res.json();
    state.user = data.user;
    state.themePreference = data.user.theme || 'dark';
    state.maxFileSizeMb = data.maxFileSizeMb || 20;
    state.storageQuotaMb = data.storageQuotaMb || 5120;
    applyTheme();
    applyUserChrome();
    updateSidebarStorage(data.summary?.totalSize || 0, state.storageQuotaMb);
    switchView('dashboard');
    hideSplash();
    loadFiles();
    loadActivity();
    loadShared();
    loadAdminSummary();
  } catch {
    // Network-level failure (server unreachable). If the splash is still up,
    // show its retry state instead of dumping the user on the landing page.
    state.user = null;
    if (!showSplashError()) switchView('landing');
  }
}

const VIEW_TITLES = {
  dashboard: 'Dashboard', files: 'My Files', shared: 'Shared Files', recent: 'Recent',
  favorites: 'Favorites', trash: 'Trash', uploads: 'Uploads', storage: 'Storage',
  settings: 'Settings', support: 'Support', activity: 'Activity', admin: 'Admin'
};

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.profile-menu').forEach((m) => m.classList.add('hidden'));
  document.querySelectorAll('[data-nav]').forEach((btn) => btn.classList.toggle('active', btn.dataset.nav === view));
  document.querySelectorAll('.page-section').forEach((section) => section.classList.add('hidden'));
  const target = document.getElementById(`${view}-page`);
  if (target) target.classList.remove('hidden');
  const titleText = VIEW_TITLES[view] || 'Frostyy Cloud';
  if (els.viewTitle) els.viewTitle.innerText = titleText;
  if (els.topbarTitle) els.topbarTitle.innerText = titleText;
  if (state.user) {
    els.authScreen.classList.add('hidden');
    els.landingScreen.classList.add('hidden');
    els.dashboardShell.classList.remove('hidden');
    applyUserChrome();
    if (view === 'dashboard') loadDashboard();
    if (view === 'files') { loadFiles(); loadFilesStatsRow(); }
    if (view === 'shared') loadShared();
    if (view === 'recent') loadRecent();
    if (view === 'favorites') loadFavorites();
    if (view === 'trash') loadTrash();
    if (view === 'activity') loadActivity();
    if (view === 'admin') { loadAdminSummary(); loadAdminUsers(); }
    if (view === 'settings') { populateSettingsForm(); loadSettingsPage(); }
    if (view === 'storage') loadStoragePage();
  } else {
    els.dashboardShell.classList.add('hidden');
    els.authScreen.classList.add('hidden');
    els.landingScreen.classList.remove('hidden');
  }
  render();
}

function resetAuthForm() {
  els.authForm.reset();
  document.getElementById('forgot-form')?.reset();
  document.getElementById('reset-form')?.reset();
  els.authError.innerText = '';
  els.authMessage.innerText = '';
  const confirmHint = document.getElementById('auth-confirm-hint');
  if (confirmHint) confirmHint.classList.add('hidden');
}

function showAuth(mode) {
  // The view must be 'auth' (not the mode name): render() only keeps the
  // landing screen hidden when state.view === 'auth'. Setting it to
  // 'login'/'signup' made every render() reveal the landing page above the
  // auth card, so a failed login appeared to jump back to the hero.
  state.view = 'auth';
  els.landingScreen.classList.add('hidden');
  els.dashboardShell.classList.add('hidden');
  els.authScreen.classList.remove('hidden');
  showAuthPanel('auth-form');
  resetAuthForm();

  document.querySelectorAll('.auth-toggle-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.authMode === mode));
  els.authTitle.innerText = mode === 'signup' ? 'Create your account' : 'Welcome back';
  document.getElementById('auth-subtitle').innerText = mode === 'signup'
    ? 'Sign up to start using Frostyy Cloud.'
    : 'Log in to access your Frostyy Cloud account.';
  els.authSwitch.innerHTML = mode === 'signup'
    ? "Already have an account? <button type=\"button\" class=\"pill-btn\" data-auth-toggle>Log in</button>"
    : "Don't have an account? <button type=\"button\" class=\"pill-btn\" data-auth-toggle>Sign up</button>";
  document.querySelector('[data-auth-toggle]').addEventListener('click', () => showAuth(mode === 'signup' ? 'login' : 'signup'));

  const passwordHint = document.getElementById('auth-password-hint');
  if (passwordHint) passwordHint.classList.toggle('hidden', mode === 'login');
  document.getElementById('auth-confirm-field')?.classList.toggle('hidden', mode === 'login');
  els.authPassword.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');

  els.authSubmit.innerHTML = mode === 'signup' ? 'Create account' : `Continue ${svgIcon('i-arrow-right')}`;
  els.authForm.dataset.mode = mode;

  const registrationMode = state.appConfig?.registrationMode || 'open';
  const disabledNote = document.getElementById('registration-disabled-note');
  const isSignupDisabled = mode === 'signup' && registrationMode === 'disabled';
  if (disabledNote) disabledNote.classList.toggle('hidden', !isSignupDisabled);
  els.authForm.classList.toggle('hidden', isSignupDisabled);
  document.getElementById('auth-forgot-row')?.classList.toggle('hidden', mode !== 'login');
}

/** Shows exactly one of the three auth-card panels (login/signup form,
 * forgot-password form, reset form) and hides the tabs for the latter two. */
function showAuthPanel(panelId) {
  ['auth-form', 'forgot-form', 'reset-form'].forEach((id) => {
    document.getElementById(id)?.classList.toggle('hidden', id !== panelId);
  });
  const inAuthForm = panelId === 'auth-form';
  document.querySelector('.auth-toggle')?.classList.toggle('hidden', !inAuthForm);
  if (els.authSwitch) els.authSwitch.classList.toggle('hidden', !inAuthForm);
}

function openAuthScreen() {
  state.view = 'auth';
  els.landingScreen.classList.add('hidden');
  els.dashboardShell.classList.add('hidden');
  els.authScreen.classList.remove('hidden');
  els.authError.innerText = '';
  els.authMessage.innerText = '';
}

function showForgotPassword() {
  openAuthScreen();
  showAuthPanel('forgot-form');
  els.authTitle.innerText = 'Reset your password';
  document.getElementById('auth-subtitle').innerText = 'Enter your email address to create a reset request.';
  const forgotEmail = document.getElementById('forgot-email');
  if (forgotEmail && !forgotEmail.value) forgotEmail.value = els.authEmail.value.trim();
  forgotEmail?.focus();
  render();
}

function showResetPanel() {
  openAuthScreen();
  showAuthPanel('reset-form');
  els.authTitle.innerText = 'Choose a new password';
  document.getElementById('auth-subtitle').innerText = 'Set a new password for your account.';
  render();
}

async function handleForgotSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) {
    els.authError.innerText = 'Enter your email address';
    return;
  }
  els.authError.innerText = '';
  const button = event.target.querySelector('button[type="submit"]');
  await withBusyButton(button, 'Sending…', async () => {
    const { data } = await sendJson('/api/auth/forgot', { email });
    els.authMessage.innerText = data.message || 'If that account exists, a reset request was created.';
  });
}

async function handleResetSubmit(event) {
  event.preventDefault();
  const password = document.getElementById('reset-password').value;
  const confirm = document.getElementById('reset-confirm-password').value;
  if (password.length < 8) {
    els.authError.innerText = 'Password must be at least 8 characters';
    return;
  }
  if (password !== confirm) {
    els.authError.innerText = 'Passwords do not match';
    return;
  }
  els.authError.innerText = '';
  const button = event.target.querySelector('button[type="submit"]');
  await withBusyButton(button, 'Saving…', async () => {
    const { res, data } = await sendJson('/api/auth/reset', { token: state.resetToken, password });
    if (!res.ok) {
      els.authError.innerText = data.error || 'Password reset failed';
      return;
    }
    state.resetToken = '';
    showAuth('login');
    els.authMessage.innerText = 'Password updated. Sign in with your new password.';
  });
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const mode = els.authForm.dataset.mode || 'login';
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const confirmPassword = els.authConfirmPassword ? els.authConfirmPassword.value : '';
  els.authError.innerText = '';
  els.authMessage.innerText = '';
  if (!email || !password) {
    els.authError.innerText = 'Email and password are required';
    return;
  }
  if (mode === 'signup' && password.length < 8) {
    els.authError.innerText = 'Password must be at least 8 characters';
    return;
  }
  if (mode === 'signup' && password !== confirmPassword) {
    els.authError.innerText = 'Passwords do not match';
    return;
  }
  state.loading = true;
  const originalLabel = els.authSubmit.innerHTML;
  els.authSubmit.disabled = true;
  els.authSubmit.innerText = mode === 'signup' ? 'Creating account…' : 'Signing in…';
  render();
  try {
    const { res, data } = await sendJson(`/api/auth/${mode === 'signup' ? 'register' : 'login'}`, { email, password });
    if (!res.ok) throw new Error(data.error || 'Authentication failed');
    state.user = data.user;
    state.themePreference = data.user.theme || 'dark';
    applyTheme();
    resetAuthForm();
    showMessage(mode === 'signup' ? 'Welcome to Frostyy Cloud.' : 'Signed in successfully.');
    switchView('dashboard');
    loadFiles();
    loadActivity();
    loadShared();
    loadAdminSummary();
  } catch (err) {
    // Server-provided message (wrong password, disabled account, ...) shows
    // inline; the auth card stays exactly where it is.
    els.authError.innerText = err.message || 'Authentication failed';
    els.authPassword.value = '';
    if (els.authConfirmPassword) els.authConfirmPassword.value = '';
    els.authPassword.focus();
  } finally {
    state.loading = false;
    els.authSubmit.disabled = false;
    els.authSubmit.innerHTML = originalLabel;
    render();
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  state.user = null;
  state.files = [];
  state.shared = [];
  state.adminUsersRaw = [];
  state.dashboardLoaded = false;
  resetAuthForm();
  switchView('landing');
}

async function loadFiles() {
  if (!state.user) return;
  state.loading = true;
  // Skeleton grid while the first listing for this folder is in flight.
  if (!state.files.length && els.fileList) {
    els.fileList.innerHTML = `<div class="skeleton-grid">${'<div class="skeleton-card"></div>'.repeat(8)}</div>`;
  }
  render();
  try {
    const params = state.currentFolder ? `?parentId=${encodeURIComponent(state.currentFolder)}` : '';
    const res = await fetch(`/api/files${params}`);
    const data = await res.json();
    if (handleAuthLoss(res)) return;
    if (!res.ok) throw new Error(data.error || 'Could not load files');
    state.files = data.items || [];
    state.breadcrumb = data.breadcrumb || [];
    state.maxFileSizeMb = data.maxFileSizeMb || state.maxFileSizeMb;
    state.storageQuotaMb = data.storageQuotaMb || state.storageQuotaMb;
    state.selectedIds.clear();
    renderFiles();
    renderBreadcrumb();
  } catch (err) {
    // "Failed to fetch" means the server never answered - say something useful.
    showError(err instanceof TypeError
      ? 'Could not load your files. Please refresh, or check the server logs.'
      : err.message);
  } finally {
    state.loading = false;
    render();
  }
}

function renderBreadcrumb() {
  if (!els.breadcrumb) return;
  const crumbs = [{ id: null, name: 'Home' }, ...(state.breadcrumb || [])];
  els.breadcrumb.innerHTML = crumbs
    .map((crumb, index) => {
      const separator = index < crumbs.length - 1 ? ' <span class="muted">/</span> ' : '';
      return `<button class="crumb-link" data-crumb="${crumb.id ?? ''}">${escapeHtml(crumb.name)}</button>${separator}`;
    })
    .join('');
  els.breadcrumb.querySelectorAll('[data-crumb]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.currentFolder = btn.dataset.crumb || null;
      state.currentPage = 1;
      loadFiles();
    });
  });
}

async function loadShared() {
  if (!state.user) return;
  try {
    const res = await fetch('/api/shared');
    const data = await res.json();
    if (handleAuthLoss(res)) return;
    if (!res.ok) throw new Error(data.error || 'Could not load shared files');
    state.shared = data.items || [];
    renderShared();
    const sharedCountEl = document.getElementById('shared-count');
    if (sharedCountEl) sharedCountEl.innerText = state.shared.length;
    const filesStatSharedEl = document.getElementById('files-stat-shared');
    if (filesStatSharedEl) filesStatSharedEl.innerText = state.shared.length;
  } catch (err) {
    showError(err.message);
  }
}

async function loadRecent() {
  if (!state.user || !els.recentFileList) return;
  try {
    const res = await fetch('/api/files/recent');
    const data = await res.json();
    if (handleAuthLoss(res)) return;
    if (!res.ok) throw new Error(data.error || 'Could not load recent files');
    renderSimpleGrid(els.recentFileList, data.items || [], { emptyText: 'No recent uploads yet.' });
  } catch (err) {
    showError(err.message);
  }
}

async function loadFavorites() {
  if (!state.user || !els.favoritesFileList) return;
  try {
    const res = await fetch('/api/favorites');
    const data = await res.json();
    if (handleAuthLoss(res)) return;
    if (!res.ok) throw new Error(data.error || 'Could not load favorites');
    renderSimpleGrid(els.favoritesFileList, data.items || [], { emptyText: "You haven't starred anything yet." });
  } catch (err) {
    showError(err.message);
  }
}

async function loadTrash() {
  if (!state.user || !els.trashFileList) return;
  try {
    const res = await fetch('/api/trash');
    const data = await res.json();
    if (handleAuthLoss(res)) return;
    if (!res.ok) throw new Error(data.error || 'Could not load trash');
    renderTrashGrid(els.trashFileList, data.items || []);
  } catch (err) {
    showError(err.message);
  }
}

async function loadActivity() {
  if (!state.user) return;
  try {
    const res = await fetch('/api/activity');
    const data = await res.json();
    if (handleAuthLoss(res)) return;
    if (!res.ok) throw new Error(data.error || 'Could not load activity');
    state.activity = data.activities || [];
    renderActivity();
    renderDashboardActivity();
  } catch (err) {
    showError(err.message);
  }
}

async function loadAdminSummary() {
  if (!state.user) return;
  try {
    const res = await fetch('/api/admin/summary');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load admin summary');
    state.admin = data;
    renderAdmin();
  } catch {
    state.admin = null;
  }
}

async function loadAdminUsers() {
  if (!state.user) return;
  const tbody = document.getElementById('admin-users-table');
  if (tbody && !state.adminUsersRaw.length) tbody.innerHTML = skeletonTableRows(6);
  try {
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (handleAuthLoss(res)) return;
    if (!res.ok) {
      // Never leave a silently empty table: say exactly what failed.
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="muted-cell">Could not load users (HTTP ${res.status}${data.error ? ` — ${escapeHtml(data.error)}` : ''}).</td></tr>`;
      return;
    }
    state.adminUsersRaw = data.users || [];
    renderAdminUsersFiltered();
  } catch {
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="muted-cell">Could not load users — the server did not respond. Check your connection and try again.</td></tr>';
  }
}

function renderAdminUsersFiltered() {
  const query = state.adminUsersSearch.trim().toLowerCase();
  const filtered = !query
    ? state.adminUsersRaw
    : state.adminUsersRaw.filter((u) =>
        (u.displayName || '').toLowerCase().includes(query) ||
        (u.username || '').toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query)
      );
  renderAdminUsers(filtered);
}

const QUOTA_PRESET_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '5120', label: '5 GB' },
  { value: '20480', label: '20 GB' },
  { value: '51200', label: '50 GB' },
  { value: '102400', label: '100 GB' },
  { value: '-1', label: 'Unlimited' }
];

function quotaLabel(quotaMb) {
  if (isUnlimitedQuota(quotaMb)) return 'Unlimited';
  return formatGb(quotaMb * 1024 * 1024);
}

function quotaSourceLabel(source) {
  if (source === 'custom') return 'Custom override';
  if (source === 'admin-default') return 'Admin default';
  return 'User default';
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('admin-users-table');
  if (!tbody) return;
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted-cell">No users match your search.</td></tr>`;
    return;
  }

  const isSelf = (u) => state.user && u.username.toLowerCase() === state.user.username.toLowerCase();
  const currentSelectValue = (u) => (u.quotaSource === 'custom' && QUOTA_PRESET_OPTIONS.some((o) => o.value === String(u.quotaMb)) ? String(u.quotaMb) : '');

  tbody.innerHTML = users.map((u) => `
    <tr data-username="${escapeHtml(u.username)}">
      <td><strong>${escapeHtml(u.displayName)}</strong><div class="muted small">${escapeHtml(u.username)}</div></td>
      <td>
        ${u.isAdmin ? '<span class="badge">Admin</span>' : 'User'}
        ${u.isAdmin && u.adminSource === 'env' ? '<div class="muted small">via ADMIN_EMAILS</div>' : ''}
        ${u.disabled ? '<div class="badge danger small">Disabled</div>' : ''}
      </td>
      <td>
        ${formatBytes(u.storageUsed)} / ${quotaLabel(u.quotaMb)}
        <div class="muted small">${quotaSourceLabel(u.quotaSource)}</div>
      </td>
      <td>${u.fileCount}</td>
      <td class="muted-cell">${u.lastActivityAt ? new Date(u.lastActivityAt).toLocaleDateString() : '—'}</td>
      <td class="col-actions">
        <div class="admin-row-actions">
          <select class="input select admin-quota-select" ${isSelf(u) ? 'disabled' : ''}>
            ${QUOTA_PRESET_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === currentSelectValue(u) ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
          <button class="ghost-btn admin-quota-apply" type="button" ${isSelf(u) ? 'disabled' : ''}>Set</button>
          <button class="ghost-btn admin-role-btn" type="button" ${isSelf(u) ? 'disabled title="You cannot change your own role"' : ''}>${u.isAdmin ? 'Demote' : 'Promote'}</button>
          <button class="ghost-btn admin-resetpw-btn" type="button" ${isSelf(u) ? 'disabled title="Use Settings to change your own password"' : ''}>Reset password</button>
          <button class="ghost-btn danger admin-disable-btn" type="button" ${isSelf(u) ? 'disabled title="You cannot disable your own account"' : ''}>${u.disabled ? 'Enable' : 'Disable'}</button>
        </div>
      </td>
    </tr>
  `).join('');

  users.forEach((u) => {
    const row = tbody.querySelector(`tr[data-username="${cssEscape(u.username)}"]`);
    if (row) bindAdminUserRowActions(row, u);
  });
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

function bindAdminUserRowActions(row, user) {
  const quotaSelect = row.querySelector('.admin-quota-select');
  const quotaBtn = row.querySelector('.admin-quota-apply');
  const roleBtn = row.querySelector('.admin-role-btn');
  const disableBtn = row.querySelector('.admin-disable-btn');
  const resetPwBtn = row.querySelector('.admin-resetpw-btn');

  resetPwBtn?.addEventListener('click', () => {
    const name = user.displayName || user.username;
    openModal('Reset password', `Reset the password for "${name}"? They will be signed out immediately and need the new temporary password to log back in.`, async () => {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.username)}/reset-password`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return showError(data.error || 'Could not reset password');
      loadAdminUsers();
      // Reopen the modal on the next tick (the confirm flow closes it first)
      // to show the temporary password once - it is not stored or logged.
      setTimeout(() => {
        openModal('Temporary password', `Temporary password for ${name}:\n\n${data.tempPassword}\n\nCopy it now — it won't be shown again. Ask them to change it in Settings after logging in.`, () => {});
      }, 0);
    }, 'Resetting…');
  });

  quotaBtn?.addEventListener('click', () => withBusyButton(quotaBtn, 'Saving…', async () => {
    const value = quotaSelect.value;
    const { res, data } = await sendJson(`/api/admin/users/${encodeURIComponent(user.username)}/quota`, {
      quotaMb: value === '' ? 'default' : value
    });
    if (!res.ok) return showError(data.error || 'Could not update quota');
    showMessage(`Quota updated for ${user.displayName || user.username}`);
    loadAdminUsers();
  }));

  roleBtn?.addEventListener('click', () => {
    const nextRole = user.isAdmin ? 'user' : 'admin';
    const verb = nextRole === 'admin' ? 'Promote' : 'Demote';
    openModal(`${verb} user`, `${verb} "${user.displayName || user.username}" ${nextRole === 'admin' ? 'to admin' : 'to a regular user'}?`, async () => {
      const { res, data } = await sendJson(`/api/admin/users/${encodeURIComponent(user.username)}/role`, { role: nextRole });
      if (!res.ok) return showError(data.error || 'Could not update role');
      showMessage(data.note || `${verb}d ${user.displayName || user.username}`);
      loadAdminUsers();
    }, 'Updating…');
  });

  disableBtn?.addEventListener('click', () => {
    const nextDisabled = !user.disabled;
    const verb = nextDisabled ? 'Disable' : 'Enable';
    const body = nextDisabled
      ? `Disable "${user.displayName || user.username}"? They will be signed out immediately and unable to log back in until re-enabled.`
      : `Re-enable "${user.displayName || user.username}"? They will be able to log in again.`;
    openModal(`${verb} account`, body, async () => {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.username)}/${nextDisabled ? 'disable' : 'enable'}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return showError(data.error || `Could not ${verb.toLowerCase()} account`);
      showMessage(`${verb}d ${user.displayName || user.username}`);
      loadAdminUsers();
    }, 'Updating…');
  });
}

function populateSettingsForm() {
  if (!state.user) return;
  const displayNameInput = document.getElementById('display-name');
  const emailInput = document.getElementById('email');
  if (displayNameInput) displayNameInput.value = state.user.displayName || '';
  if (emailInput) emailInput.value = state.user.email || '';
}

async function loadSettingsPage() {
  if (!state.user) return;
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!res.ok) return;
    const totalSize = data.summary?.totalSize || 0;
    const fileCount = data.summary?.fileCount || 0;
    const quotaMb = data.storageQuotaMb ?? state.storageQuotaMb;
    const q = applyQuotaBar(document.getElementById('settings-storage-bar'), totalSize, quotaMb);
    document.getElementById('settings-storage-used').innerText = formatBytes(totalSize);
    document.getElementById('settings-file-count').innerText = fileCount;
    document.getElementById('settings-storage-label').innerText = q.isUnlimited
      ? `${formatBytes(totalSize)} used · Unlimited plan`
      : `${q.percent}% of ${q.totalLabel} used`;
  } catch {
    // ignore
  }
}

async function loadStoragePage() {
  if (!state.user) return;
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!res.ok) return;
    const totalSize = data.summary?.totalSize || 0;
    const quotaMb = data.storageQuotaMb ?? state.storageQuotaMb;
    const q = applyQuotaBar(document.getElementById('storage-page-bar'), totalSize, quotaMb);
    document.getElementById('storage-page-progress-label').innerText = q.isUnlimited ? 'Unlimited plan' : `${q.percent}% used`;
    document.getElementById('plan-quota-free').innerText = q.totalLabel;
  } catch {
    // ignore
  }
}

async function loadFilesStatsRow() {
  if (!state.user) return;
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!res.ok) return;
    document.getElementById('files-stat-count').innerText = data.summary?.fileCount || 0;
    document.getElementById('files-stat-storage').innerText = formatBytes(data.summary?.totalSize || 0);
    document.getElementById('files-stat-trash').innerText = data.summary?.trashedCount || 0;
    document.getElementById('files-stat-shared').innerText = (state.shared || []).length;
  } catch {
    // ignore - the file grid below still works without the stats row
  }
}

/** Skeleton <tr> placeholder rows for a table that's still loading. */
function skeletonTableRows(cols, rows = 3) {
  return Array.from({ length: rows }, () =>
    `<tr>${Array.from({ length: cols }, () => '<td><span class="skeleton-line"></span></td>').join('')}</tr>`
  ).join('');
}

/** Shimmer placeholders in the dashboard stat cards until real data lands. */
function showDashboardSkeleton() {
  ['storage-used', 'file-count', 'shared-count', 'trash-count'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="skeleton-line w-sm"></span>';
  });
  const uploads = document.getElementById('recent-uploads');
  if (uploads) uploads.innerHTML = '<span class="skeleton-line w-md"></span> <span class="skeleton-line w-md"></span>';
}

async function loadDashboard() {
  if (!state.user) return;
  if (!state.dashboardLoaded) showDashboardSkeleton();
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load dashboard');
    const totalSize = data.summary?.totalSize || 0;
    const fileCount = data.summary?.fileCount || 0;
    const quotaMb = data.storageQuotaMb ?? state.storageQuotaMb;
    const recentFiles = [...state.files].filter((item) => item.type === 'file').sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0)).slice(0, 4);
    document.getElementById('storage-used').innerText = formatBytes(totalSize);
    document.getElementById('file-count').innerText = fileCount;
    document.getElementById('recent-uploads').innerHTML = recentFiles.length
      ? recentFiles.map((item) => `<div class="badge">${getFileVisual(item, 'sm')} ${escapeHtml(item.name)}</div>`).join('')
      : '<div class="empty-state">No uploads yet. Upload your first file to see it here.</div>';
    const q = applyQuotaBar(document.getElementById('storage-bar'), totalSize, quotaMb);
    document.getElementById('storage-progress-label').innerText = q.isUnlimited ? 'Unlimited plan' : `${q.percent}% of ${q.totalLabel} used`;
    document.getElementById('storage-limit-note').innerText = q.isUnlimited
      ? `Unlimited storage · ${state.maxFileSizeMb} MB per file`
      : `Plan limit: ${q.totalLabel} · ${state.maxFileSizeMb} MB per file`;
    document.getElementById('shared-count').innerText = (state.shared || []).length;
    document.getElementById('trash-count').innerText = data.summary?.trashedCount || 0;
    document.getElementById('trash-retention-note').innerText = data.trashRetentionDays || 30;
    updateSidebarStorage(totalSize, quotaMb);
    renderDashboardActivity();
    state.dashboardLoaded = true;
  } catch {
    // Clear any skeleton placeholders so the cards don't shimmer forever.
    ['storage-used', 'file-count', 'shared-count', 'trash-count'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.querySelector('.skeleton-line')) el.innerText = '—';
    });
    const uploads = document.getElementById('recent-uploads');
    if (uploads && uploads.querySelector('.skeleton-line')) {
      uploads.innerHTML = '<div class="empty-state">Could not load dashboard data. Check your connection and refresh.</div>';
    }
  }
}

function renderDashboardActivity() {
  const el = document.getElementById('dashboard-activity');
  if (!el) return;
  const recent = (state.activity || []).slice(0, 5);
  el.innerHTML = recent.length
    ? recent.map((entry) => `
        <div class="activity-row">
          <strong>${escapeHtml(entry.action)}</strong>
          <span class="small muted">${escapeHtml(entry.details?.file || entry.details?.folder || '')} · ${new Date(entry.createdAt).toLocaleString()}</span>
        </div>
      `).join('')
    : '<div class="empty-state">No activity yet.</div>';
}

function render() {
  els.messageBox.innerHTML = state.message ? `<div class="message">${escapeHtml(state.message)}</div>` : '';
  els.errorBox.innerHTML = state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : '';
  els.loadingBox.classList.toggle('hidden', !state.loading);
  els.dashboardShell.classList.toggle('hidden', !state.user);
  els.authScreen.classList.toggle('hidden', state.user || state.view === 'landing');
  els.landingScreen.classList.toggle('hidden', !!state.user || state.view === 'auth');
  if (state.user) applyUserChrome();
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    if (state.sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
    if (state.sortBy === 'size') return (b.size || 0) - (a.size || 0);
    if (state.sortBy === 'type') return (a.type || '').localeCompare(b.type || '');
    return new Date(b.createdAt || b.uploadedAt || 0) - new Date(a.createdAt || a.uploadedAt || 0);
  });
}

function renderFiles() {
  const filtered = sortItems(
    state.files.filter((item) => {
      const name = item.name || '';
      const matchesSearch = name.toLowerCase().includes(state.search.toLowerCase());
      const matchesType = state.filterType === 'all' || item.type === state.filterType;
      return matchesSearch && matchesType;
    })
  );

  els.fileList.classList.toggle('list-view', !state.showGrid);
  updateDropzoneDensity();

  if (!filtered.length) {
    renderFilesEmptyState();
    updateSelectionToolbar();
    renderPagination(0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  state.currentPage = Math.min(state.currentPage, totalPages);
  const start = (state.currentPage - 1) * state.pageSize;
  const pageItems = filtered.slice(start, start + state.pageSize);

  if (state.showGrid) {
    renderFileGrid(pageItems);
  } else {
    renderFileTable(pageItems);
  }
  updateSelectionToolbar();
  renderPagination(filtered.length);
}

function renderFilesEmptyState() {
  const hasSearchOrFilter = state.search || state.filterType !== 'all';
  els.fileList.innerHTML = hasSearchOrFilter
    ? `<div class="empty-state"><strong>No matching files</strong>Try a different search term or filter.</div>`
    : `
      <div class="empty-state files-empty-state">
        <strong>No files here yet</strong>
        Upload a file or create a folder to get started.
        <div class="row" style="justify-content:center;margin-top:var(--sp-4);">
          <button class="btn" id="empty-state-upload-btn" type="button">${svgIcon('i-upload-cloud')} Upload file</button>
          <button class="ghost-btn" id="empty-state-folder-btn" type="button">${svgIcon('i-folder-plus')} Create folder</button>
        </div>
      </div>
    `;
  document.getElementById('empty-state-upload-btn')?.addEventListener('click', () => els.uploadInput.click());
  document.getElementById('empty-state-folder-btn')?.addEventListener('click', createFolder);
}

function updateDropzoneDensity() {
  if (!els.dropzone) return;
  const isEmptyAccount = !state.currentFolder && !state.files.length && !state.search;
  els.dropzone.classList.toggle('compact', !isEmptyAccount);
}

function renderPagination(total) {
  if (!els.pagination) return;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  if (!total || totalPages <= 1) { els.pagination.innerHTML = ''; return; }
  const current = state.currentPage;
  const start = (current - 1) * state.pageSize + 1;
  const end = Math.min(total, current * state.pageSize);

  const pages = buildPageList(current, totalPages);
  const pageButtons = pages.map((p) =>
    p === '...' ? '<span class="pagination-ellipsis">…</span>' : `<button class="pagination-page-btn ${p === current ? 'active' : ''}" data-page="${p}">${p}</button>`
  ).join('');

  els.pagination.innerHTML = `
    <span>Showing ${start} to ${end} of ${total} files</span>
    <div class="pagination-pages">
      <button class="pagination-page-btn" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>${svgIcon('i-arrow-left')}</button>
      ${pageButtons}
      <button class="pagination-page-btn" data-page="${current + 1}" ${current === totalPages ? 'disabled' : ''}>${svgIcon('i-arrow-right')}</button>
    </div>
    <select class="input select pagination-size-select" id="page-size-select">
      ${[12, 24, 48, 96].map((n) => `<option value="${n}" ${n === state.pageSize ? 'selected' : ''}>${n} per page</option>`).join('')}
    </select>
  `;
  els.pagination.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.page);
      if (page < 1 || page > totalPages) return;
      state.currentPage = page;
      renderFiles();
    });
  });
  document.getElementById('page-size-select')?.addEventListener('change', (e) => {
    state.pageSize = Number(e.target.value);
    state.currentPage = 1;
    renderFiles();
  });
}

function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push('...');
    result.push(p);
  });
  return result;
}

function fileActionsHtml(item, isFolder, isPreviewable) {
  return `
    ${isFolder ? `<button class="profile-menu-item" data-open-folder="${item.id}">${svgIcon('i-folder')} Open</button>` : `<button class="profile-menu-item" data-download="${item.id}">${svgIcon('i-download')} Download</button>`}
    ${isPreviewable ? `<button class="profile-menu-item" data-preview="${item.id}">${svgIcon('i-image')} Preview</button>` : ''}
    ${!isFolder ? `<button class="profile-menu-item" data-share="${item.id}">${svgIcon('i-link')} Share</button>` : ''}
    <button class="profile-menu-item" data-move="${item.id}">${svgIcon('i-folder-plus')} Move to…</button>
    <button class="profile-menu-item" data-rename="${item.id}">${svgIcon('i-sliders')} Rename</button>
    <button class="profile-menu-item danger" data-delete="${item.id}">${svgIcon('i-trash')} Delete</button>
  `;
}

function bindCardActions(card, item) {
  card.querySelector('[data-select]')?.addEventListener('change', () => toggleSelection(item.id));
  card.querySelector('[data-download]')?.addEventListener('click', () => downloadFile(item.id));
  card.querySelectorAll('[data-open-folder]').forEach((el) => el.addEventListener('click', () => openFolder(item.id)));
  card.querySelector('[data-preview]')?.addEventListener('click', () => previewFile(item));
  card.querySelector('[data-share]')?.addEventListener('click', () => shareFile(item.id));
  card.querySelector('[data-rename]')?.addEventListener('click', () => renameItem(item));
  card.querySelector('[data-delete]')?.addEventListener('click', () => deleteItem(item));
  card.querySelector('[data-favorite]')?.addEventListener('click', () => toggleFavorite(item.id));
  card.querySelector('[data-move]')?.addEventListener('click', () => openMoveModal(item));
  const menuToggle = card.querySelector('[data-menu-toggle]');
  const menu = card.querySelector('[data-menu]');
  if (menuToggle && menu) {
    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = menu.classList.contains('hidden');
      document.querySelectorAll('.file-card-menu').forEach((m) => m.classList.add('hidden'));
      if (willOpen) menu.classList.remove('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== menuToggle) menu.classList.add('hidden');
    });
  }
}

function renderFileGrid(items) {
  els.fileList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const isFolder = item.type === 'folder';
    const isPreviewable = !isFolder && (item.mimeType?.startsWith('image/') || item.mimeType === 'application/pdf');
    const card = document.createElement('div');
    card.className = `file-card ${state.selectedIds.has(item.id) ? 'selected' : ''}`;
    const modified = item.uploadedAt || item.createdAt;
    card.innerHTML = `
      <input type="checkbox" class="file-card-select" data-select="${item.id}" ${state.selectedIds.has(item.id) ? 'checked' : ''} />
      <button class="file-card-menu-btn" data-menu-toggle="${item.id}" aria-label="More actions" title="More actions">${svgIcon('i-more')}</button>
      <div class="file-card-menu profile-menu hidden" data-menu="${item.id}">${fileActionsHtml(item, isFolder, isPreviewable)}</div>
      <div class="file-icon">${getFileVisual(item)}</div>
      <div class="file-meta">
        <strong title="${escapeHtml(item.displayName || item.name)}">${escapeHtml(item.displayName || item.name)}</strong>
        <div class="file-meta-line">${isFolder ? 'Folder' : formatBytes(item.size || 0)}${modified ? ` <span aria-hidden="true">&middot;</span> ${formatShortDate(modified)}` : ''}</div>
      </div>
      <button class="star-btn ${item.favorite ? 'active' : ''}" data-favorite="${item.id}" aria-label="${item.favorite ? 'Remove from favorites' : 'Add to favorites'}" title="${item.favorite ? 'Remove from favorites' : 'Add to favorites'}">${svgIcon('i-star')}</button>
    `;
    if (isFolder) card.querySelector('.file-icon').addEventListener('click', () => openFolder(item.id));
    bindCardActions(card, item);
    fragment.appendChild(card);
  });
  els.fileList.appendChild(fragment);
}

const SORT_COLUMNS = { name: 'Name', size: 'Size', date: 'Modified' };

function renderFileTable(items) {
  const headerCells = Object.entries(SORT_COLUMNS)
    .map(([key, label]) => {
      const active = state.sortBy === key;
      return `<th class="sortable ${active ? 'sort-active' : ''}" data-sort-key="${key}">${label}<span class="sort-arrow">↓</span></th>`;
    })
    .join('');

  const rows = items
    .map((item) => {
      const isFolder = item.type === 'folder';
      const isPreviewable = !isFolder && (item.mimeType?.startsWith('image/') || item.mimeType === 'application/pdf');
      const modified = item.uploadedAt || item.createdAt;
      return `
        <tr class="${state.selectedIds.has(item.id) ? 'selected' : ''}" data-row-id="${item.id}">
          <td class="col-select"><input type="checkbox" data-select="${item.id}" ${state.selectedIds.has(item.id) ? 'checked' : ''} /></td>
          <td class="col-name"><span class="file-icon">${getFileVisual(item)}</span><strong ${isFolder ? `data-open-folder="${item.id}" style="cursor:pointer"` : ''}>${escapeHtml(item.displayName || item.name)}</strong>
            <button class="star-btn small ${item.favorite ? 'active' : ''}" data-favorite="${item.id}" title="Favorite">${svgIcon('i-star')}</button>
          </td>
          <td class="muted-cell">${isFolder ? '—' : formatBytes(item.size || 0)}</td>
          <td class="muted-cell">${modified ? formatShortDate(modified) : '—'}</td>
          <td class="col-actions"><div class="file-actions">
            ${isFolder ? `<button class="pill-btn" data-open-folder="${item.id}">Open</button>` : `<button class="pill-btn" data-download="${item.id}">Download</button>`}
            ${isPreviewable ? `<button class="ghost-btn" data-preview="${item.id}">Preview</button>` : ''}
            ${!isFolder ? `<button class="ghost-btn" data-share="${item.id}">Share</button>` : ''}
            <button class="ghost-btn" data-rename="${item.id}">Rename</button>
            <button class="ghost-btn danger" data-delete="${item.id}">Delete</button>
          </div></td>
        </tr>
      `;
    })
    .join('');

  els.fileList.innerHTML = `
    <div class="file-table-wrap">
      <table class="file-table">
        <thead><tr><th class="col-select"></th>${headerCells}<th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  els.fileList.querySelectorAll('th[data-sort-key]').forEach((th) => {
    th.addEventListener('click', () => {
      state.sortBy = th.dataset.sortKey;
      if (els.sortSelect) els.sortSelect.value = state.sortBy;
      renderFiles();
    });
  });
  items.forEach((item) => {
    const row = els.fileList.querySelector(`tr[data-row-id="${item.id}"]`);
    if (row) bindCardActions(row, item);
  });
}

function renderSimpleGrid(container, items, { emptyText = 'Nothing here yet.' } = {}) {
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }
  container.innerHTML = '';
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const isFolder = item.type === 'folder';
    const isPreviewable = !isFolder && (item.mimeType?.startsWith('image/') || item.mimeType === 'application/pdf');
    const card = document.createElement('div');
    card.className = 'file-card';
    card.innerHTML = `
      <button class="file-card-menu-btn" data-menu-toggle="${item.id}">${svgIcon('i-more')}</button>
      <div class="file-card-menu profile-menu hidden" data-menu="${item.id}">${fileActionsHtml(item, isFolder, isPreviewable)}</div>
      <div class="file-icon">${getFileVisual(item)}</div>
      <div class="file-meta"><strong>${escapeHtml(item.displayName || item.name)}</strong><br>${isFolder ? 'Folder' : formatBytes(item.size || 0)}</div>
      <button class="star-btn ${item.favorite ? 'active' : ''}" data-favorite="${item.id}" title="Toggle favorite">${svgIcon('i-star')}</button>
    `;
    bindCardActions(card, item);
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}

function getPurgeCountdownText(purgeAt) {
  if (!purgeAt) return { text: '', soon: false };
  const daysLeft = Math.ceil((new Date(purgeAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysLeft <= 0) return { text: 'Deletes very soon', soon: true };
  if (daysLeft === 1) return { text: 'Deletes tomorrow', soon: true };
  return { text: `Deletes in ${daysLeft} days`, soon: daysLeft <= 3 };
}

function renderTrashGrid(container, items) {
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">Trash is empty.</div>';
    return;
  }
  container.innerHTML = '';
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const isFolder = item.type === 'folder';
    const countdown = getPurgeCountdownText(item.purgeAt);
    const card = document.createElement('div');
    card.className = 'file-card';
    card.innerHTML = `
      <div class="file-icon">${getFileVisual(item)}</div>
      <div class="file-meta"><strong>${escapeHtml(item.displayName || item.name)}</strong><br>${isFolder ? 'Folder' : formatBytes(item.size || 0)}</div>
      <div class="trash-countdown ${countdown.soon ? 'soon' : ''}">${countdown.text}</div>
      <div class="file-actions">
        <button class="pill-btn" data-restore="${item.id}">${svgIcon('i-restore')} Restore</button>
        <button class="ghost-btn danger" data-forget="${item.id}">${svgIcon('i-trash')} Delete forever</button>
      </div>
    `;
    card.querySelector('[data-restore]').addEventListener('click', () => restoreItem(item));
    card.querySelector('[data-forget]').addEventListener('click', () => permanentDeleteItem(item));
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}

function renderShared() {
  if (!state.shared.length) {
    els.sharedList.innerHTML = '<div class="empty-state">No shared files yet.</div>';
    return;
  }
  els.sharedList.innerHTML = state.shared.map((item) => `
    <div class="file-card">
      <div class="file-icon">${getFileVisual(item)}</div>
      <div class="file-meta"><strong>${escapeHtml(item.name)}</strong><br>${formatBytes(item.size || 0)}</div>
      <div class="file-actions"><button class="btn" data-copy-link="${item.id}">Copy link</button><button class="ghost-btn" data-unshare="${item.id}">Disable</button></div>
    </div>
  `).join('');
  els.sharedList.querySelectorAll('[data-copy-link]').forEach((btn) => btn.addEventListener('click', () => copyShareLink(btn.dataset.copyLink)));
  els.sharedList.querySelectorAll('[data-unshare]').forEach((btn) => btn.addEventListener('click', () => disableShare(btn.dataset.unshare)));
}

function renderActivity() {
  if (!state.activity?.length) {
    els.activityList.innerHTML = '<div class="empty-state">No recent activity yet.</div>';
    return;
  }
  els.activityList.innerHTML = state.activity.map((entry) => `
    <div class="card"><strong>${escapeHtml(entry.action)}</strong><div class="muted small">${escapeHtml(entry.details?.file || entry.details?.folder || '')} · ${new Date(entry.createdAt).toLocaleString()}</div></div>
  `).join('');
}

function renderAdmin() {
  if (!state.admin) return;
  document.getElementById('admin-users').innerText = state.admin.totalUsers || 0;
  document.getElementById('admin-files').innerText = state.admin.totalFiles || 0;
  document.getElementById('admin-storage').innerText = formatBytes(state.admin.totalStorageUsed || 0);
  document.getElementById('admin-activity').innerHTML = (state.admin.recentActivity || []).map((item) => `<div class="badge">${escapeHtml(item.action)}</div>`).join('');
}

function updateSelectionToolbar() {
  const count = state.selectedIds.size;
  els.bulkActions.classList.toggle('hidden', count === 0);
  document.getElementById('default-toolbar')?.classList.toggle('hidden', count > 0);
  if (els.selectionCount) els.selectionCount.innerText = `${count} selected`;
  if (els.selectAllCheckbox) {
    const visibleCheckboxes = els.fileList.querySelectorAll('[data-select]');
    els.selectAllCheckbox.checked = visibleCheckboxes.length > 0 && [...visibleCheckboxes].every((cb) => cb.checked);
  }
  const selectedItems = [...state.selectedIds].map((id) => state.files.find((item) => item.id === id)).filter(Boolean);
  const hasFile = selectedItems.some((item) => item.type === 'file');
  const singleFileSelected = selectedItems.filter((item) => item.type === 'file').length === 1;
  const bulkShareBtn = document.getElementById('bulk-share');
  const bulkDownloadBtn = document.getElementById('bulk-download');
  if (bulkShareBtn) {
    bulkShareBtn.disabled = !singleFileSelected;
    bulkShareBtn.title = singleFileSelected ? 'Copy share link' : 'Select exactly one file to share';
  }
  if (bulkDownloadBtn) {
    bulkDownloadBtn.disabled = !hasFile;
    bulkDownloadBtn.title = hasFile ? 'Download' : 'Select at least one file to download';
  }
}

function toggleSelectAll(e) {
  const checked = e.target.checked;
  els.fileList.querySelectorAll('[data-select]').forEach((cb) => {
    const id = cb.dataset.select;
    if (checked) state.selectedIds.add(id); else state.selectedIds.delete(id);
    cb.checked = checked;
  });
  updateSelectionToolbar();
}

function toggleSelection(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id); else state.selectedIds.add(id);
  renderFiles();
}

let createFolderInFlight = false;
async function createFolder() {
  if (createFolderInFlight) return;
  const name = prompt('Folder name');
  if (!name) return;
  createFolderInFlight = true;
  try {
    const { res, data } = await sendJson('/api/folders', { name, parentId: state.currentFolder });
    if (!res.ok) return showError(data.error || 'Unable to create folder');
    showMessage('Folder created');
    loadFiles();
  } finally {
    createFolderInFlight = false;
  }
}

async function uploadFiles(files) {
  if (!files?.length) return;
  const queue = Array.from(files);
  let uploaded = 0;
  const progressWrap = document.getElementById('upload-progress-wrap');
  if (progressWrap) progressWrap.classList.remove('hidden');
  for (const file of queue) {
    try {
      await uploadSingleFile(file, queue.length);
      uploaded += 1;
    } catch (err) {
      showError(err.message || `Failed to upload ${file.name}`);
    }
  }
  state.uploadProgress = 0;
  els.progressBar.style.width = '0%';
  els.progressText.innerText = 'Ready';
  if (progressWrap) progressWrap.classList.add('hidden');
  if (uploaded) showMessage(`${uploaded} file${uploaded === 1 ? '' : 's'} uploaded successfully`);
  loadFiles();
  loadFilesStatsRow();
}

function uploadSingleFile(file, total) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    if (state.currentFolder) formData.append('folderId', state.currentFolder);
    state.loading = true;
    render();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        state.uploadProgress = Math.round((event.loaded / event.total) * 100);
        els.progressBar.style.width = `${state.uploadProgress}%`;
        els.progressText.innerText = total > 1 ? `Uploading ${file.name} (${state.uploadProgress}%)` : `${state.uploadProgress}% uploaded`;
        render();
      }
    };
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      state.loading = false;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed'));
        } catch {
          reject(new Error('Upload failed'));
        }
      }
    };
    xhr.send(formData);
  });
}

async function downloadFile(id) {
  window.open(`/api/files/${id}/download`);
}

function openFolder(id) {
  state.currentFolder = id;
  state.currentPage = 1;
  if (state.view !== 'files') switchView('files');
  else loadFiles();
}

async function bulkDelete() {
  if (!state.selectedIds.size) return;
  const count = state.selectedIds.size;
  openModal('Move to trash', `Move ${count} item${count === 1 ? '' : 's'} to trash? You can restore them later.`, async () => {
    const ids = [...state.selectedIds];
    const { res, data } = await sendJson('/api/files/bulk-delete', { ids });
    if (!res.ok) return showError(data.error || 'Delete failed');
    state.selectedIds.clear();
    showMessage('Moved to trash');
    loadFiles();
  }, 'Deleting…');
}

async function bulkDownload() {
  const ids = [...state.selectedIds];
  const items = ids.map((id) => state.files.find((item) => item.id === id)).filter((item) => item && item.type === 'file');
  items.forEach((item) => downloadFile(item.id));
  if (!items.length) showError('Select at least one file to download');
}

async function bulkShare() {
  const ids = [...state.selectedIds];
  const item = ids.map((id) => state.files.find((entry) => entry.id === id)).find((entry) => entry && entry.type === 'file');
  if (!item) return showError('Select a file to share');
  await shareFile(item.id);
}

function bulkMove() {
  const items = [...state.selectedIds].map((id) => state.files.find((entry) => entry.id === id)).filter(Boolean);
  if (!items.length) return showError('Select at least one item to move');
  openMoveModal(items);
}

function clearSelection() {
  state.selectedIds.clear();
  renderFiles();
}

async function deleteItem(item) {
  openModal('Move to trash', `Move "${item.name}" to trash?`, async () => {
    const res = await fetch(`/api/files/${item.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return showError(data.error || 'Delete failed');
    showMessage('Moved to trash');
    loadFiles();
  }, 'Deleting…');
}

async function restoreItem(item) {
  const res = await fetch(`/api/files/${item.id}/restore`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return showError(data.error || 'Restore failed');
  showMessage('Restored');
  loadTrash();
}

async function permanentDeleteItem(item) {
  openModal('Delete forever', `Permanently delete "${item.name}"? This cannot be undone.`, async () => {
    const res = await fetch(`/api/files/${item.id}/permanent`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return showError(data.error || 'Delete failed');
    showMessage('Permanently deleted');
    loadTrash();
  }, 'Deleting…');
}

async function emptyTrash() {
  openModal('Empty trash', 'Permanently delete everything in your trash? This cannot be undone.', async () => {
    const res = await fetch('/api/trash/empty', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return showError(data.error || 'Could not empty trash');
    showMessage('Trash emptied');
    loadTrash();
  }, 'Deleting…');
}

async function toggleFavorite(id) {
  const res = await fetch(`/api/files/${id}/favorite`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return showError(data.error || 'Could not update favorite');
  if (state.view === 'favorites') loadFavorites();
  else if (state.view === 'recent') loadRecent();
  else loadFiles();
}

async function renameItem(item) {
  const nextName = prompt('New name', item.displayName || item.name);
  if (!nextName || nextName === item.name) return;
  const { res, data } = await sendJson(`/api/files/${item.id}/rename`, { name: nextName });
  if (!res.ok) return showError(data.error || 'Rename failed');
  showMessage('Renamed successfully');
  loadFiles();
}

async function shareFile(id) {
  const res = await fetch(`/api/files/${id}/share`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return showError(data.error || 'Could not create share link');
  const link = `${window.location.origin}${data.shareLink}`;
  await navigator.clipboard.writeText(link).catch(() => {});
  showMessage('Share link created and copied to clipboard');
  loadShared();
}

function previewFile(item) {
  const isImage = item.mimeType?.startsWith('image/');
  const src = `/api/files/${item.id}/preview`;
  els.previewFrame.innerHTML = isImage ? `<img src="${src}" alt="${escapeHtml(item.name)}" />` : `<iframe src="${src}" title="${escapeHtml(item.name)}"></iframe>`;
  els.previewModal.classList.remove('hidden');
}

let moveContext = null;

function findFolderNode(tree, id) {
  for (const node of tree) {
    if (node.id === id) return node;
    const found = findFolderNode(node.children || [], id);
    if (found) return found;
  }
  return null;
}

function collectSubtreeIds(node) {
  const ids = [node.id];
  (node.children || []).forEach((child) => ids.push(...collectSubtreeIds(child)));
  return ids;
}

async function openMoveModal(itemOrItems) {
  const items = Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems];
  if (!items.length) return;
  moveContext = { items };
  const modal = document.getElementById('move-modal');
  const subtitle = document.getElementById('move-modal-subtitle');
  const list = document.getElementById('move-folder-list');
  subtitle.innerText = items.length === 1
    ? `Choose a destination for "${items[0].displayName || items[0].name}".`
    : `Choose a destination for ${items.length} items.`;
  list.innerHTML = '<div class="search-loading">Loading folders…</div>';
  modal.classList.remove('hidden');
  try {
    const res = await fetch('/api/folders/tree');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load folders');
    renderMoveFolderList(list, data.tree || [], items);
  } catch (err) {
    list.innerHTML = `<div class="search-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderMoveFolderList(container, tree, items) {
  const disabledIds = new Set();
  items.forEach((item) => {
    if (item.type === 'folder') {
      const node = findFolderNode(tree, item.id);
      if (node) collectSubtreeIds(node).forEach((id) => disabledIds.add(id));
    }
  });
  const commonParentId = items.every((i) => i.parentId === items[0].parentId) ? items[0].parentId : undefined;

  const rows = [`<button class="move-folder-row ${!commonParentId ? 'current' : ''}" data-dest="">${svgIcon('i-drive')} Home (root)</button>`];
  const walk = (nodes, depth) => {
    nodes.forEach((node) => {
      const disabled = disabledIds.has(node.id);
      const isCurrent = commonParentId !== undefined && node.id === commonParentId;
      rows.push(`<button class="move-folder-row ${isCurrent ? 'current' : ''}" data-dest="${node.id}" style="padding-left:${16 + depth * 20}px" ${disabled ? 'disabled' : ''}>${svgIcon('i-folder')} ${escapeHtml(node.name)}</button>`);
      if (node.children?.length) walk(node.children, depth + 1);
    });
  };
  walk(tree, 0);
  container.innerHTML = rows.join('');
  container.querySelectorAll('[data-dest]:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Disable every destination row so a slow move can't be double-fired.
      container.querySelectorAll('[data-dest]').forEach((row) => { row.disabled = true; });
      withBusyButton(btn, 'Moving…', () => performMove(btn.dataset.dest || null));
    });
  });
}

async function performMove(destId) {
  const items = moveContext?.items || [];
  if (!items.length) return;
  const results = await Promise.all(items.map((item) =>
    sendJson(`/api/files/${item.id}/move`, { parentId: destId || null })
      .then(({ res, data }) => ({ ok: res.ok, data, item }))
  ));
  document.getElementById('move-modal').classList.add('hidden');
  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  if (succeeded.length) showMessage(succeeded.length === 1 ? `Moved "${succeeded[0].item.name}"` : `Moved ${succeeded.length} items`);
  if (failed.length) showError(failed[0].data.error || 'Some items could not be moved');
  state.selectedIds.clear();
  if (state.view === 'files') loadFiles();
  else if (state.view === 'favorites') loadFavorites();
  else if (state.view === 'recent') loadRecent();
}

async function withBusyButton(button, busyLabel, fn) {
  if (!button) return fn();
  const originalLabel = button.innerText;
  button.disabled = true;
  button.innerText = busyLabel;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerText = originalLabel;
  }
}

async function submitSupport(event) {
  event.preventDefault();
  const subject = document.getElementById('support-subject').value.trim();
  const message = document.getElementById('support-message').value.trim();
  if (!subject || !message) return showError('Subject and message are required');
  const button = event.target.querySelector('button[type="submit"]');
  await withBusyButton(button, 'Sending…', async () => {
    const { res, data } = await sendJson('/api/support/ticket', { subject, message });
    if (!res.ok) return showError(data.error || 'Support request failed');
    showMessage('Support request submitted');
    event.target.reset();
  });
}

async function submitSettings(event) {
  event.preventDefault();
  const payload = {
    displayName: document.getElementById('display-name').value,
    email: document.getElementById('email').value,
    theme: state.themePreference
  };
  const button = event.target.querySelector('button[type="submit"]');
  await withBusyButton(button, 'Saving…', async () => {
    const { res, data } = await sendJson('/api/auth/profile', payload, 'PUT');
    if (!res.ok) return showError(data.error || 'Profile update failed');
    state.user = data.user;
    showMessage('Profile updated');
    render();
  });
}

async function submitPassword(event) {
  event.preventDefault();
  const newPassword = document.getElementById('new-password').value;
  if (newPassword && newPassword.length < 8) return showError('New password must be at least 8 characters');
  const payload = {
    currentPassword: document.getElementById('current-password').value,
    newPassword
  };
  const button = event.target.querySelector('button[type="submit"]');
  await withBusyButton(button, 'Updating…', async () => {
    const { res, data } = await sendJson('/api/auth/password', payload);
    if (!res.ok) return showError(data.error || 'Password update failed');
    event.target.reset();
    showMessage('Password updated');
  });
}

function toggleTheme() {
  setThemePreference(state.theme === 'dark' ? 'light' : 'dark');
}

async function copyShareLink(id) {
  const item = state.shared.find((entry) => entry.id === id);
  if (!item) return;
  const link = `${window.location.origin}/api/share/${item.shareToken}`;
  await navigator.clipboard.writeText(link);
  showMessage('Share link copied');
}

async function disableShare(id) {
  const res = await fetch(`/api/files/${id}/share`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) return showError(data.error || 'Could not disable share');
  showMessage('Share link disabled');
  loadShared();
}

function openModal(title, body, onConfirm, busyLabel = 'Working…') {
  state.modal = { title, body, onConfirm, busyLabel };
  els.modalTitle.innerText = title;
  els.modalBody.innerText = body;
  els.modalBackdrop.classList.remove('hidden');
}

function closeModal() {
  state.modal = null;
  els.modalBackdrop.classList.add('hidden');
}

async function handleModalConfirm() {
  const { onConfirm, busyLabel } = state.modal || {};
  if (!onConfirm) return closeModal();
  await withBusyButton(els.modalConfirm, busyLabel || 'Working…', onConfirm);
  closeModal();
}

function svgIcon(symbolId, extraClass = '') {
  return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#${symbolId}"/></svg>`;
}

const EXTENSION_BADGES = {
  pdf: { label: 'PDF', className: 'badge-pdf' },
  doc: { label: 'W', className: 'badge-doc' },
  docx: { label: 'W', className: 'badge-doc' },
  xls: { label: 'X', className: 'badge-xls' },
  xlsx: { label: 'X', className: 'badge-xls' },
  csv: { label: 'X', className: 'badge-xls' },
  ppt: { label: 'P', className: 'badge-ppt' },
  pptx: { label: 'P', className: 'badge-ppt' },
  zip: { label: 'ZIP', className: 'badge-zip' },
  rar: { label: 'ZIP', className: 'badge-zip' },
  fig: { label: '◆', className: 'badge-design' },
  psd: { label: 'Ps', className: 'badge-design' },
  ai: { label: 'Ai', className: 'badge-design' },
  sketch: { label: '◆', className: 'badge-design' }
};

function getFileVisual(item, size = 'md') {
  if (item.type === 'folder') return svgIcon('i-folder', 'icon-folder');
  if (item.mimeType?.startsWith('image/')) {
    if (size === 'sm') return svgIcon('i-image', 'icon-image');
    return `<img class="file-thumb" src="/api/files/${item.id}/preview" alt="" loading="lazy" />`;
  }
  if (item.mimeType?.includes('video')) {
    return `<span class="file-video-icon">${svgIcon('i-video', 'icon-video')}</span>`;
  }
  const ext = (item.name || '').split('.').pop()?.toLowerCase();
  const badge = EXTENSION_BADGES[ext];
  if (badge) return `<span class="file-badge ${badge.className}" style="width:100%;height:100%">${badge.label}</span>`;
  if (item.mimeType === 'application/pdf') return `<span class="file-badge badge-pdf" style="width:100%;height:100%">PDF</span>`;
  return svgIcon('i-file', 'icon-file');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const isSameDay = date.toDateString() === today.toDateString();
  if (isSameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const isSameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString([], isSameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

window.addEventListener('DOMContentLoaded', init);
