document.addEventListener("DOMContentLoaded", () => {
    const statusIndicator = document.getElementById("connection-status");
    const clockDisplay = document.getElementById("clock-display");
    const priceDisplay = document.getElementById("price-display");
    const tempDisplay = document.getElementById("temp-display");
    
    const latestActionContainer = document.getElementById("latest-action-container");
    const guidelinesList = document.getElementById("guidelines-list");
    const guidelinesCount = document.getElementById("guidelines-count");
    const historyTbody = document.getElementById("history-tbody");

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
                if(payload.latestAction) renderLatestAction(payload.latestAction);
                if(payload.guidelines) renderGuidelines(payload.guidelines);
                if(payload.actionHistory) renderHistory(payload.actionHistory);
                if(payload.lastClock) clockDisplay.innerText = payload.lastClock;
                if(payload.lastPrice) updatePrice(payload.lastPrice);
                if(payload.lastTemp) updateTemp(payload.lastTemp);
                break;
            case "clock":
                clockDisplay.innerText = payload.data;
                break;
            case "grid_price":
                updatePrice(payload.data);
                break;
            case "weather_temperature":
                updateTemp(payload.data);
                break;
            case "action_issued":
                renderLatestAction(payload.data);
                break;
            case "history_updated":
                renderHistory(payload.data);
                break;
            case "guidelines_updated":
                renderGuidelines(payload.data);
                break;
            case "override_success":
                clearActionPanel();
                break;
        }
    }

    function updatePrice(val) {
        priceDisplay.innerHTML = `$${val.toFixed(3)} <small>/kWh</small>`;
        if (val > 0.25) priceDisplay.style.color = 'var(--accent-red)';
        else priceDisplay.style.color = 'var(--accent-green)';
    }

    function updateTemp(val) {
        tempDisplay.innerText = `${val.toFixed(1)}°F`;
        if (val > 85) tempDisplay.style.color = 'var(--accent-red)';
        else if (val < 50) tempDisplay.style.color = 'var(--accent-blue)';
        else tempDisplay.style.color = 'var(--text-primary)';
    }

    function renderLatestAction(actionItem) {
        if (!actionItem) {
            clearActionPanel();
            return;
        }
        const actionSlug = actionItem.action.toLowerCase().replace(/_/g, '-');
        latestActionContainer.className = "action-box";
        latestActionContainer.innerHTML = `
            <div class="action-header">
                <span class="action-name ${actionSlug}">${actionItem.action.replace(/_/g, ' ')}</span>
                <button class="override-btn" onclick="triggerOverride()">Override</button>
            </div>
            <div class="action-reason">
                <strong>Reasoning:</strong> ${actionItem.reason}
                <br/><small style="color:var(--text-secondary); margin-top:5px; display:inline-block">${actionItem.timestamp}</small>
            </div>
        `;
    }

    function clearActionPanel() {
        latestActionContainer.className = "waiting-state";
        latestActionContainer.innerHTML = `
            <div class="pulse-ring"></div>
            <p id="action-status-text">Waiting for first decision...</p>
        `;
    }

    function renderGuidelines(guidelines) {
        guidelinesCount.innerText = guidelines.length;
        guidelinesList.innerHTML = '';
        guidelines.forEach(g => {
            const li = document.createElement("li");
            li.className = "guideline-item";
            li.innerHTML = `
                <span class="text">${g.text}</span>
                <button class="delete-btn">✕</button>
            `;
            const btn = li.querySelector('.delete-btn');
            btn.dataset.id = g.id;
            btn.addEventListener('click', () => deleteGuideline(g.id));
            guidelinesList.appendChild(li);
        });
    }

    function renderHistory(history) {
        historyTbody.innerHTML = '';
        history.forEach(item => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${item.timestamp}</td>
                <td><span class="history-action">${item.action}</span></td>
                <td>${item.reason}</td>
            `;
            historyTbody.appendChild(tr);
        });
    }

    window.triggerOverride = async () => {
        try {
            await fetch('/api/override', { method: 'POST' });
        } catch (err) {
            console.error(err);
        }
    };

    window.deleteGuideline = async (id) => {
        try {
            await fetch(`/api/guidelines/${id}`, { method: 'DELETE' });
        } catch (err) {
            console.error(err);
        }
    };
});
