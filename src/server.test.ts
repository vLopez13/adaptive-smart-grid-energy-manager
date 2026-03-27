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
