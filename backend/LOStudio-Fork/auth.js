const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'lostudio-dev-secret';

/**
 * Verify and decode a JWT token.
 * Returns the payload (with userId) or throws on invalid/expired token.
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Express middleware that authenticates requests via Bearer token.
 * In LOCAL_MODE, bypasses auth and sets req.user = { id: 1 }.
 */
function authMiddleware(req, res, next) {
  if (process.env.LOCAL_MODE === '1') {
    req.user = { id: '1' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: '未提供认证令牌' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.userId };
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: '认证令牌无效或已过期' });
  }
}

/**
 * Initialize auth on the Express app.
 * Called as: setupAuth(app)
 */
function setupAuth(app) {
  // Auth is handled via middleware; no routes to register here.
  // RPA and Higgsfield routes use authMiddleware directly.
}

setupAuth.authMiddleware = authMiddleware;
setupAuth.verifyToken = verifyToken;

module.exports = setupAuth;
