// @ts-nocheck
const oktaConfig = {
    issuer: 'https://OKTA_DOMAIN/oauth2/default',
    clientId: 'OKTA_CLIENT_ID',
    redirectUri: window.location.origin + '/login/callback',
    scopes: ['openid', 'profile', 'email']
};

const authClient = new OktaAuth(oktaConfig);

async function initAuth() {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.getElementById('app-container');

    // Handle the redirect callback
    if (authClient.isLoginRedirect()) {
        try {
            await authClient.handleLoginRedirect();
        } catch (e) {
            console.error('Login error:', e);
        }
    }

    const isAuthenticated = await authClient.isAuthenticated();

    if (isAuthenticated) {
        authOverlay.style.display = 'none';
        appContainer.style.display = 'flex';
        // Start the SSE stream or any app logic here if needed
        if (window.startApp) window.startApp();
    } else {
        authOverlay.style.display = 'flex';
        appContainer.style.display = 'none';
    }

    loginBtn.addEventListener('click', () => {
        // Since we are using placeholders, we simulate a successful login for now 
        // to let the user see the "Wow" dashboard even without real Okta credentials.
        if (oktaConfig.clientId === 'OKTA_CLIENT_ID') {
            console.warn("Using Okta Placeholders. Simulating login for demo...");
            authOverlay.style.display = 'none';
            appContainer.style.display = 'flex';
            if (window.startApp) window.startApp();
        } else {
            authClient.signInWithRedirect();
        }
    });

    logoutBtn.addEventListener('click', () => {
        if (oktaConfig.clientId === 'OKTA_CLIENT_ID') {
            window.location.reload();
        } else {
            authClient.signOut();
        }
    });
}

document.addEventListener("DOMContentLoaded", initAuth);
