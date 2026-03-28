document.addEventListener('DOMContentLoaded', async () => {
    const statusIndicator = document.getElementById("connection-status");
    const clockDisplay = document.getElementById("clock-display");
    const priceDisplay = document.getElementById("price-display");
    const tempDisplay = document.getElementById("temp-display");

    const latestActionContainer = document.getElementById("latest-action-container");
    const guidelinesList = document.getElementById("guidelines-list");
    const guidelinesCount = document.getElementById("guidelines-count");
    const historyTbody = document.getElementById("history-tbody");

    // Track the action currently shown so Override sends the right action to the server.
    let currentActionName = null;

    // Fetch user profile
    try {
        const userRes = await fetch('/api/me');
        if (userRes.ok) {
            const user = await userRes.json();
            const profileDiv = document.getElementById('user-profile');
            profileDiv.innerHTML = `
                <img src="${user.picture}" alt="${user.name}" class="avatar">
                <span class="user-name">${user.name}</span>
            `;
        }
    } catch (err) {
        console.error('Failed to fetch user profile:', err);
    }

    // Set logout link
    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn.addEventListener('click', () => {
        window.location.href = '/logout';
    });

    // Connect SSE
    const evtSource = new EventSource("/api/stream");

    evtSource.onopen = () => {
        statusIndicator.classList.add("connected");
    };

    evtSource.onerror = () => {
        statusIndicator.classList.remove("connected");
    };

    evtSource.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        handleStreamEvent(payload);
    };

    function handleStreamEvent(payload) {
        switch (payload.type) {
            case "init":
                if (payload.latestAction) {
                    renderLatestAction(payload.latestAction);
                    updateEnergyFlow(payload.latestAction.action);
                }
                if (payload.guidelines) renderGuidelines(payload.guidelines);
                if (payload.actionHistory) renderHistory(payload.actionHistory);
                if (payload.lastClock) clockDisplay.innerText = payload.lastClock;
                if (payload.lastPrice) updatePrice(payload.lastPrice);
                if (payload.lastTemp) updateTemp(payload.lastTemp);
                if (payload.preferencesUnavailable) showWarning("preferences-warning", "Preferences unavailable");
                break;
            case "clock":
                clockDisplay.innerText = payload.data;
                clearStaleWarning("clock");
                break;
            case "grid_price":
                updatePrice(payload.data);
                clearStaleWarning("grid_price");
                break;
            case "weather_temperature":
                updateTemp(payload.data);
                clearStaleWarning("weather_temperature");
                break;
            case "action_issued":
                renderLatestAction(payload.data);
                updateEnergyFlow(payload.data.action);
                clearDecisionTimeout();
                break;
            case "history_updated":
                renderHistory(payload.data);
                break;
            case "guidelines_updated":
                renderGuidelines(payload.data);
                break;
            case "override_success":
                clearActionPanel();
                updateEnergyFlow(null);
                showOverrideConfirmation();
                break;
            case "stale_data":
                showStaleWarning(payload.stream);
                break;
            case "decision_timeout":
                showDecisionTimeout();
                break;
            case "decision_error":
                showDecisionError(payload.message);
                break;
        }
    }

    function updatePrice(val) {
        priceDisplay.innerHTML = `$${val.toFixed(3)} <small>/kWh</small>`;
        priceDisplay.style.color = val > 0.25 ? 'var(--accent-red)' : 'var(--accent-green)';
        clearStaleWarning("grid_price");
    }

    function updateTemp(val) {
        tempDisplay.innerText = `${val.toFixed(1)}°F`;
        if (val > 85) tempDisplay.style.color = 'var(--accent-red)';
        else if (val < 50) tempDisplay.style.color = 'var(--accent-blue)';
        else tempDisplay.style.color = 'var(--text-primary)';
        clearStaleWarning("weather_temperature");
    }

    function renderLatestAction(actionItem) {
        if (!actionItem) { currentActionName = null; clearActionPanel(); return; }
        currentActionName = actionItem.action;
        const actionSlug = actionItem.action.toLowerCase().replace(/_/g, '-');
        latestActionContainer.className = "action-box";
        latestActionContainer.innerHTML = `
            <div class="action-header">
                <span class="action-name ${actionSlug}">${actionItem.action.replace(/_/g, ' ')}</span>
                <button class="override-btn" id="override-btn" title="Cancel this action and teach the agent not to do it again">Reject Action & Teach</button>
            </div>
            <div class="action-reason">
                <strong>Reasoning:</strong> ${actionItem.reason}
                <br/><small style="color:var(--text-secondary); margin-top:5px; display:inline-block">${actionItem.timestamp}</small>
            </div>
        `;
        document.getElementById("override-btn").addEventListener("click", triggerOverride);
    }

    function clearActionPanel() {
        latestActionContainer.className = "waiting-state";
        latestActionContainer.innerHTML = `
            <div class="pulse-ring"></div>
            <p id="action-status-text">Waiting for first decision...</p>
        `;
    }

    function showOverrideConfirmation() {
        latestActionContainer.className = "waiting-state override-success-state";
        latestActionContainer.innerHTML = `
            <div class="success-icon">✓</div>
            <div class="status-content">
                <p id="action-status-text" style="color: var(--accent-green); font-weight: 600; margin-bottom: 0.25rem;">Action Rejected</p>
                <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4;">The agent learned your preference and added a new guideline.</p>
            </div>
        `;
        setTimeout(() => clearActionPanel(), 4000);
    }

    function renderGuidelines(guidelines) {
        guidelinesCount.innerText = guidelines.length;
        guidelinesList.innerHTML = '';
        guidelines.forEach(g => {
            const li = document.createElement("li");
            li.className = "guideline-item";
            const deleteBtn = document.createElement("button");
            deleteBtn.className = "delete-btn";
            deleteBtn.textContent = "✕";
            deleteBtn.dataset.id = g.id;
            deleteBtn.addEventListener("click", () => deleteGuideline(g.id));
            const span = document.createElement("span");
            span.className = "text";
            span.textContent = g.text;
            li.appendChild(span);
            li.appendChild(deleteBtn);
            guidelinesList.appendChild(li);
        });
    }

    function renderHistory(history) {
        historyTbody.innerHTML = '';
        history.forEach(item => {
            const tr = document.createElement("tr");
            const tdTime = document.createElement("td");
            const tdAction = document.createElement("td");
            const tdReason = document.createElement("td");
            tdTime.textContent = item.timestamp;
            tdAction.innerHTML = `<span class="history-action">${item.action}</span>`;
            tdReason.textContent = item.reason;
            tr.appendChild(tdTime);
            tr.appendChild(tdAction);
            tr.appendChild(tdReason);
            historyTbody.appendChild(tr);
        });
    }

    // ====== Stale data warnings ======
    function showStaleWarning(stream) {
        const cardId = `data-card-${stream.replace('_', '-')}`;
        const card = document.getElementById(cardId);
        if (!card) return;
        if (!card.querySelector('.stale-badge')) {
            const badge = document.createElement("span");
            badge.className = "stale-badge";
            badge.id = `stale-${stream}`;
            badge.textContent = "Stale";
            card.appendChild(badge);
        }
    }

    function clearStaleWarning(stream) {
        const badge = document.getElementById(`stale-${stream}`);
        if (badge) badge.remove();
    }

    // ====== Decision timeout ======
    function showDecisionTimeout() {
        if (latestActionContainer.querySelector('.timeout-warning')) return;
        const warn = document.createElement("p");
        warn.className = "timeout-warning";
        warn.textContent = "Decision timeout";
        latestActionContainer.appendChild(warn);
    }

    function clearDecisionTimeout() {
        const warn = latestActionContainer.querySelector('.timeout-warning');
        if (warn) warn.remove();
    }

    // ====== Decision error ======
    function showDecisionError(message) {
        latestActionContainer.className = "waiting-state";
        latestActionContainer.innerHTML = `
            <p style="color:var(--accent-red)">Decision error: ${message}</p>
        `;
    }

    // ====== Generic warning banner ======
    function showWarning(id, text) {
        if (document.getElementById(id)) return;
        const banner = document.createElement("div");
        banner.id = id;
        banner.className = "warning-banner";
        banner.textContent = text;
        document.querySelector(".app-container").prepend(banner);
    }

    async function triggerOverride(event) {
        const btn = event.currentTarget;
        btn.disabled = true;
        btn.innerText = 'Teaching Agent...';
        try {
            await fetch('/api/override', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Send the action the user saw at click time, not whatever the server
                // has as latestAction by the time the request lands (race condition fix).
                body: JSON.stringify({ action: currentActionName }),
            });
        } catch (err) {
            btn.disabled = false;
            btn.innerText = 'Reject Action & Teach';
            console.error(err);
        }
    }

    async function deleteGuideline(id) {
        try {
            await fetch(`/api/guidelines/${id}`, { method: 'DELETE' });
        } catch (err) {
            console.error(err);
        }
    }

    function updateEnergyFlow(action) {
        document.querySelectorAll('.flow-path').forEach(path => {
            path.classList.remove('flow-active', 'flow-charging', 'flow-selling', 'flow-buying');
        });
        if (!action) return;
        const mappings = {
            'SELL_TO_GRID':       { id: 'flow-battery-grid', classes: ['flow-active', 'flow-selling'] },
            'BUY_FROM_GRID':      { id: 'flow-grid-home',    classes: ['flow-active', 'flow-buying'] },
            'STORE_IN_BATTERY':   { id: 'flow-solar-battery',classes: ['flow-active', 'flow-charging'] },
            'DISCHARGE_BATTERY':  { id: 'flow-battery-home', classes: ['flow-active'] },
            'SHUT_OFF_AC':        { id: null },
            'RESTORE_AC':         { id: 'flow-solar-home',   classes: ['flow-active'] },
            'CHARGE_EV_NOW':      { id: 'flow-grid-home',    classes: ['flow-active', 'flow-buying'] },
            'PAUSE_EV_CHARGING':  { id: null },
        };
        const flow = mappings[action];
        if (flow && flow.id) {
            const path = document.getElementById(flow.id);
            if (path) path.classList.add(...flow.classes);
        }
    }
});

    // ====== Pause/Resume functionality (Req US-001) ======
    function updatePauseUI() {
        if (isPaused && pausedUntil) {
            showPauseOverlay(pausedUntil);
        } else {
            hidePauseOverlay();
        }
    }

    function showPauseOverlay(remainingMs) {
        let overlay = document.getElementById('pause-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'pause-overlay';
            overlay.className = 'pause-overlay';
            document.body.appendChild(overlay);
        }

        const existingBtn = document.getElementById('resume-btn');
        if (!existingBtn) {
            overlay.innerHTML = `
                <div class="pause-content">
                    <div class="pause-icon">⏸</div>
                    <p class="pause-text">Paused</p>
                    <p class="pause-countdown" id="pause-countdown">resumes in 30s</p>
                    <button class="primary-btn" id="resume-btn">Resume</button>
                </div>
            `;
            document.getElementById('resume-btn').addEventListener('click', async () => {
                await fetch('/api/resume', { method: 'POST' });
            });
        }

        if (pauseCountdownInterval) clearInterval(pauseCountdownInterval);
        let remaining = remainingMs;
        pauseCountdownInterval = setInterval(() => {
            remaining -= 1000;
            const seconds = Math.ceil(remaining / 1000);
            if (seconds <= 0) {
                clearInterval(pauseCountdownInterval);
            } else {
                const countdown = document.getElementById('pause-countdown');
                if (countdown) {
                    countdown.textContent = `resumes in ${seconds}s`;
                }
            }
        }, 1000);

        overlay.style.display = 'flex';
    }

    function hidePauseOverlay() {
        const overlay = document.getElementById('pause-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
        if (pauseCountdownInterval) {
            clearInterval(pauseCountdownInterval);
            pauseCountdownInterval = null;
        }
    }
