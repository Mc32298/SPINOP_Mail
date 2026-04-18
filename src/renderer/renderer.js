// =============================================================================
// STATE
// =============================================================================

let isTutorialActive = false;
const sidebar = document.querySelector('.sidebar');
const addBtn = document.getElementById('btn-add');

// =============================================================================
// ONBOARDING
// =============================================================================

function startOnboarding() {
  isTutorialActive = true;
  document.getElementById('onboarding-overlay').classList.remove('onboarding-hidden');
}

function nextOnboardingStep(step) {
  const overlay = document.getElementById('onboarding-overlay');
  document.getElementById('step-1').style.display = 'none';
  document.getElementById('step-2').style.display = 'none';

  if (step === 2) {
    document.getElementById('step-2').style.display = 'block';
  } else if (step === 3) {
    // Hide card and show pointer
    document.getElementById('onboarding-card').style.display = 'none';
    document.getElementById('onboarding-pointer').classList.remove('pointer-hidden');

    // Make overlay click-through so the user can hit the "+" button
    overlay.classList.add('onboarding-passthrough');
  }
}

function showDeleteTutorial() {
  const overlay = document.getElementById('onboarding-overlay');

  // Bring back the blur/card focus
  overlay.classList.remove('onboarding-passthrough');

  document.getElementById('onboarding-pointer').classList.add('pointer-hidden');
  document.getElementById('onboarding-card').style.display = 'block';

  // Hide previous steps and show the Delete step
  document.getElementById('step-1').style.display = 'none';
  document.getElementById('step-2').style.display = 'none';
  document.getElementById('step-delete').style.display = 'block';
}

function showFinalThanks() {
  document.getElementById('step-delete').style.display = 'none';
  document.getElementById('step-final').style.display = 'block';
}

function closeOnboarding() {
  document.getElementById('onboarding-overlay').classList.add('onboarding-hidden');
  isTutorialActive = false;

  // Trigger the first mail view to appear
  const firstBtn = document.querySelector('.mail-btn');
  if (firstBtn) firstBtn.click();
}

// =============================================================================
// SIDEBAR & ACCOUNTS
// =============================================================================

function createSidebarButton(acc) {
  // Prevent duplicates
  if (document.getElementById(acc.id)) return;

  const btn = document.createElement('button');
  btn.id = acc.id;
  btn.className = 'mail-btn';
  btn.title = acc.name;
  btn.innerHTML = `
    <span class="material-symbols-outlined">${acc.icon}</span>
    <span class="btn-label">${acc.name}</span>
  `;

  btn.addEventListener('click', () => {
    document.querySelectorAll('.sidebar button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    window.mailAPI.loadMail(acc.id);
  });

  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.mailAPI.showContextMenu({ id: acc.id, name: acc.name });
  });

  sidebar.insertBefore(btn, addBtn);
  return btn;
}

// =============================================================================
// IPC LISTENERS
// =============================================================================

// Initial accounts load
window.mailAPI.onInitAccounts((accounts) => {
  if (accounts.length === 0) {
    startOnboarding();
  } else {
    accounts.forEach(acc => createSidebarButton(acc));
    const firstBtn = document.querySelector('.mail-btn');
    if (firstBtn) firstBtn.click();
  }
});

// New account added
window.mailAPI.onNewAccount((acc) => {
  const newBtn = createSidebarButton(acc);

  if (isTutorialActive) {
    showDeleteTutorial();
  } else {
    if (newBtn) newBtn.click();
  }
});

// Account deleted
window.mailAPI.onAccountDeleted((id) => {
  const btnToRemove = document.getElementById(id);
  if (btnToRemove) {
    const wasActive = btnToRemove.classList.contains('active');
    btnToRemove.remove();
    if (wasActive) {
      const nextBtn = document.querySelector('.mail-btn');
      if (nextBtn) nextBtn.click();
    }
  }
});

// Account renamed
window.mailAPI.onAccountUpdated(({ id, newName }) => {
  const btn = document.getElementById(id);
  if (btn) {
    const label = btn.querySelector('.btn-label');
    if (label) label.innerText = newName;
    btn.title = newName;
  }
});

// =============================================================================
// UI EVENT LISTENERS
// =============================================================================

// Add inbox button
addBtn.addEventListener('click', () => {
  window.mailAPI.openAddWindow(isTutorialActive);
});

// Window controls
document.querySelector('.close').addEventListener('click', () => window.mailAPI.closeApp());
document.querySelector('.minimize').addEventListener('click', () => window.mailAPI.minimizeApp());
document.querySelector('.maximize').addEventListener('click', () => window.mailAPI.maximizeApp());

// Feedback button
document.getElementById('btn-feedback').addEventListener('click', () => {
  window.mailAPI.openExternal('https://github.com/Mc32298/Spinophowto');
});