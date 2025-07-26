const { createMiddleware } = require('hono/factory');

// ページの閲覧に認証を必須にするミドルウェア
function ensureAuthenticated() {
  return createMiddleware(async (c, next) => {
    const session = c.get('session');
    if (!session.user) {
      return c.redirect('/login');
    }
    await next();
  });
}

module.exports = ensureAuthenticated;
