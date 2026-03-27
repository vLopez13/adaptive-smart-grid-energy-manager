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
        if (window.startApp) window.startApp();
    } else {
        authOverlay.style.display = 'flex';
        appContainer.style.display = 'none';
    }

    loginBtn.addEventListener('click', () => {
        // Placeholder credentials: simulate login for demo purposes
        if (oktaConfig.clientId === 'OKTA_CLIENT_ID') {
            console.warn('Using Okta placeholders — simulating login for demo.');
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

document.addEventListener('DOMContentLoaded', initAuth);
