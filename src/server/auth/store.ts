import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  provider: string;
  provider_id: string;
  role: string;
  created_at: string;
  last_login_at: string;
}

interface SessionRow {
  sid: string;
  user_id: string;
  expires: number;
  data: string | null;
}

const dbPath = path.join(os.homedir(), '.opencodewiki', 'auth.db');

let db: DatabaseSync;

function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT UNIQUE NOT NULL,
        name          TEXT NOT NULL,
        avatar_url    TEXT,
        provider      TEXT NOT NULL,
        provider_id   TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        last_login_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id);
    `);
    // Migrate: add role column if missing
    try { db.exec('ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT \'user\''); } catch {}
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid       TEXT PRIMARY KEY,
        user_id   TEXT NOT NULL REFERENCES users(id),
        expires   INTEGER NOT NULL,
        data      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
    `);
  }
  return db;
}

// ── User operations ──

export function upsertUser(
  provider: string,
  providerId: string,
  email: string,
  name: string,
  avatarUrl: string | null,
  role?: string,
): { id: string; isNew: boolean } {
  const d = getDb();
  const existing = d.prepare('SELECT id, role FROM users WHERE provider = ? AND provider_id = ?').get(provider, providerId) as { id: string; role: string } | undefined;

  const now = new Date().toISOString();
  if (existing) {
    const finalRole = role || existing.role;
    d.prepare('UPDATE users SET email = ?, name = ?, avatar_url = ?, role = ?, last_login_at = ? WHERE id = ?')
      .run(email, name, avatarUrl, finalRole, now, existing.id);
    return { id: existing.id, isNew: false };
  }

  const id = crypto.randomUUID();
  const finalRole = role || 'user';
  d.prepare('INSERT INTO users (id, email, name, avatar_url, provider, provider_id, role, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, email, name, avatarUrl, provider, providerId, finalRole, now, now);
  return { id, isNew: true };
}

export function getUser(id: string): UserRow | undefined {
  const d = getDb();
  return d.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

// ── Session operations ──

export interface SessionData {
  sid: string;
  userId: string;
  expires: number;
}

export function createSession(userId: string, maxAgeMs: number): SessionData {
  const d = getDb();
  const sid = crypto.randomUUID();
  const expires = Date.now() + maxAgeMs;
  d.prepare('INSERT INTO sessions (sid, user_id, expires) VALUES (?, ?, ?)')
    .run(sid, userId, expires);
  return { sid, userId, expires };
}

export function getSession(sid: string): SessionData | undefined {
  const d = getDb();
  const row = d.prepare('SELECT sid, user_id AS userId, expires FROM sessions WHERE sid = ? AND expires > ?')
    .get(sid, Date.now()) as SessionData | undefined;
  return row;
}

export function deleteSession(sid: string): void {
  const d = getDb();
  d.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
}

/** Remove expired sessions (called periodically). */
export function cleanupExpiredSessions(): void {
  const d = getDb();
  d.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
}
