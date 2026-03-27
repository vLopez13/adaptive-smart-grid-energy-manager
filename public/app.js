// Expose startApp globally so auth.js can call it after login.
// auth.js is responsible for calling window.startApp() once authenticated.
window.startApp = startApp;

function startApp() {
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
                <button class="override-btn" id="override-btn">Override</button>
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
        latestActionContainer.className = "waiting-state";
        latestActionContainer.innerHTML = `
            <div class="pulse-ring"></div>
            <p id="action-status-text">Override received — action cancelled</p>
        `;
        setTimeout(() => clearActionPanel(), 3000);
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

    async function triggerOverride() {
        try {
            await fetch('/api/override', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Send the action the user saw at click time, not whatever the server
                // has as latestAction by the time the request lands (race condition fix).
                body: JSON.stringify({ action: currentActionName }),
            });
        } catch (err) {
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
}
