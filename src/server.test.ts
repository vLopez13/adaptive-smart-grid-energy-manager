import request from 'supertest';
import { app } from './server';

// Mock express-openid-connect
jest.mock('express-openid-connect', () => {
    return {
        auth: () => (req: any, res: any, next: any) => {
            // Mock oidc object on request
            req.oidc = {
                isAuthenticated: () => !!req.headers.authorization,
                user: {
                    name: 'Test User',
                    email: 'test@example.com',
                    picture: 'https://example.com/avatar.png'
                }
            };
            next();
        },
        requiresAuth: () => (req: any, res: any, next: any) => {
            if (req.oidc.isAuthenticated()) {
                next();
            } else {
                res.status(302).setHeader('Location', '/login').end();
            }
        }
    };
});

describe('Auth Security Integration', () => {
    it('GET / should redirect to /login if unauthenticated', async () => {
        const response = await request(app).get('/');
        expect(response.status).toBe(302);
        expect(response.header.location).toBe('/login');
    });

    it('GET /api/me should redirect to /login if unauthenticated', async () => {
        const response = await request(app).get('/api/me');
        expect(response.status).toBe(302);
    });

    it('GET /api/stream should redirect to /login if unauthenticated', async () => {
        const response = await request(app).get('/api/stream');
        expect(response.status).toBe(302);
    });

    it('GET /api/me should return user data if authenticated', async () => {
        // We simulate authentication by adding an Authorization header (as per our mock logic)
        const response = await request(app)
            .get('/api/me')
            .set('Authorization', 'Bearer fake-token');
        
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            name: 'Test User',
            email: 'test@example.com',
            picture: 'https://example.com/avatar.png'
        });
    });

    it('POST /api/override should be protected', async () => {
        const response = await request(app).post('/api/override').send({ action: 'TEST' });
        expect(response.status).toBe(302);
    });
});

describe('US-002: Decision Tree Preview Endpoint', () => {
    const authHeader = 'Bearer fake-token';

    it('should be protected by auth', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .send({ ruleText: 'Do not SHUT_OFF_AC when Temperature > 90' });
        expect(response.status).toBe(302);
    });

    it('should reject missing ruleText parameter', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .set('Authorization', authHeader)
            .send({});
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('Missing or invalid ruleText');
    });

    it('should reject invalid rule format', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .set('Authorization', authHeader)
            .send({ ruleText: 'invalid rule text' });
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('expected format');
    });

    it('should parse and validate rule text correctly', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .set('Authorization', authHeader)
            .send({ ruleText: 'Do not SHUT_OFF_AC when Temperature > 90' });
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('blockedAction');
        expect(response.body).toHaveProperty('topAlternatives');
    });

    it('should return blockedAction matching the rule', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .set('Authorization', authHeader)
            .send({ ruleText: 'Do not SELL_TO_GRID when Grid_Price >= 0.40' });
        expect(response.status).toBe(200);
        expect(response.body.blockedAction).toBe('SELL_TO_GRID');
    });

    it('should return topAlternatives array with up to 3 items', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .set('Authorization', authHeader)
            .send({ ruleText: 'Do not PAUSE_EV_CHARGING when Clock_Hour >= 10' });
        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.topAlternatives)).toBe(true);
        expect(response.body.topAlternatives.length).toBeLessThanOrEqual(3);
    });

    it('topAlternatives should have action, reason, and urgency properties', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .set('Authorization', authHeader)
            .send({ ruleText: 'Do not BUY_FROM_GRID when Grid_Price <= 0.10' });
        expect(response.status).toBe(200);
        if (response.body.topAlternatives.length > 0) {
            const alt = response.body.topAlternatives[0];
            expect(alt).toHaveProperty('action');
            expect(alt).toHaveProperty('reason');
            expect(alt).toHaveProperty('urgency');
            expect(typeof alt.urgency).toBe('number');
            expect(alt.urgency).toBeGreaterThanOrEqual(0);
            expect(alt.urgency).toBeLessThanOrEqual(10);
        }
    });

    it('should not block action that is in topAlternatives', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .set('Authorization', authHeader)
            .send({ ruleText: 'Do not CHARGE_EV_NOW when Clock_Hour >= 12' });
        expect(response.status).toBe(200);
        const blockedAction = response.body.blockedAction;
        const alternativeActions = response.body.topAlternatives.map((alt: any) => alt.action);
        expect(alternativeActions).not.toContain(blockedAction);
    });

    it('should handle case-insensitive field names', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .set('Authorization', authHeader)
            .send({ ruleText: 'Do not DISCHARGE_BATTERY when grid_price >= 0.30' });
        expect(response.status).toBe(200);
        expect(response.body.blockedAction).toBe('DISCHARGE_BATTERY');
    });

    it('should trim whitespace from ruleText', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .set('Authorization', authHeader)
            .send({ ruleText: '  Do not STORE_IN_BATTERY when Temperature <= 50  ' });
        expect(response.status).toBe(200);
        expect(response.body.blockedAction).toBe('STORE_IN_BATTERY');
    });

    it('should handle errors gracefully', async () => {
        const response = await request(app)
            .post('/api/preview-decision-with-rule')
            .set('Authorization', authHeader)
            .send({ ruleText: null });
        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('error');
    });
});
