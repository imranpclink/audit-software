// Password hashing (scrypt, from Node's crypto) and login.
const crypto = require('node:crypto');

function AUDIT_hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function AUDIT_checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function AUDIT_LOGIN(db, username, password) {
  const user = db.get('SELECT * FROM AUDIT_USER WHERE username = ? AND active = 1', String(username || '').trim().toLowerCase());
  if (!user || !AUDIT_checkPassword(String(password || ''), user.password_hash)) return null;
  return user;
}

module.exports = { AUDIT_hashPassword, AUDIT_checkPassword, AUDIT_LOGIN };
