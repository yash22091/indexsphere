import Database from 'better-sqlite3';
import { join } from 'path';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import bcrypt from 'bcryptjs';

// ── Encryption helpers for sensitive stored values (e.g. ES passwords) ────────
// Key is derived from JWT_SECRET so it rotates if the secret changes.
function getEncryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET ?? 'indexsphere_default_enc_key_32ch';
  return createHash('sha256').update(secret).digest();
}

export function encryptValue(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptValue(stored: string): string {
  const [ivHex, authTagHex, encHex] = stored.split(':');
  if (!ivHex || !authTagHex || !encHex) return stored; // not encrypted
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
}

const BCRYPT_ROUNDS = 12;

// User and Connection interfaces
export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user' | 'readonly';
  created_at: string;
  updated_at: string;
  last_login?: string;
  is_active: boolean;
  must_change_password?: boolean;
}

export interface Connection {
  id: string;
  name: string;
  url: string;
  username?: string;
  password?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

// ── New feature interfaces ──────────────────────────────────────────────────
export interface SavedConnection {
  id: string;
  name: string;
  url: string;
  username?: string;
  password_enc?: string;  // AES-256-GCM encrypted
  color: string;
  description?: string;
  allowed_roles: string;  // JSON array: ["admin","user"]
  ssl_verify: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  last_connected?: string;
}

export interface AuditLogEntry {
  id: string;
  user_id?: string;
  username?: string;
  action: string;
  target?: string;
  method?: string;
  endpoint?: string;
  request_body?: string;
  status_code?: number;
  duration_ms?: number;
  ip_address?: string;
  cluster_url?: string;
  created_at: string;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: string;       // 'cpu_percent'|'heap_percent'|'gc_pressure'|'unassigned_shards'|'doc_count_delta'
  operator: string;     // 'gt'|'lt'|'gte'|'lte'
  threshold: number;
  window_minutes: number;
  severity: string;     // 'info'|'warning'|'critical'
  channels: string;     // JSON: [{type,to/url}]
  connection_id?: string;
  is_active: boolean;
  last_triggered?: string;
  trigger_count: number;
  created_at: string;
  updated_at: string;
}

export interface AlertTrigger {
  id: string;
  rule_id: string;
  metric: string;
  value: number;
  threshold: number;
  severity: string;
  message?: string;
  resolved: boolean;
  created_at: string;
}

export interface ScheduledReport {
  id: string;
  name: string;
  report_type: string;    // 'cluster_health'|'index_stats'|'full_cluster'|'custom'
  format: string;         // 'pdf'|'csv'|'json'
  cron_expression: string;
  email_to: string;       // JSON array of email addresses
  email_subject?: string;
  connection_id?: string;
  is_active: boolean;
  last_run?: string;
  next_run?: string;
  last_status?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AppSetting {
  key: string;
  value: string;
  updated_at: string;
}

/** Async bcrypt hash — use for all new password storage. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Synchronous hash used ONLY during database initialisation (constructor context).
 * Do NOT use this in API request handlers — use the async hashPassword() instead.
 */
export function hashPasswordSync(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a stored hash.
 * Supports both bcrypt (current) and the legacy SHA-256+static-salt scheme
 * so that existing accounts continue to work after the upgrade.
 * Legacy hashes are automatically re-hashed to bcrypt on successful login.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith('$2b$') || hash.startsWith('$2a$')) {
    return bcrypt.compare(password, hash);
  }
  // Legacy SHA-256 fallback for accounts created before the bcrypt upgrade
  const legacyHash = createHash('sha256')
    .update(password + 'indexsphere_salt_2024')
    .digest('hex');
  return legacyHash === hash;
}

class SQLiteDatabase {
  private db: Database.Database;
  private readonly dbPath: string;

  constructor() {
    const dataDir = join(process.cwd(), 'data');
    this.dbPath = join(dataDir, 'indexsphere.db');
    
    // Ensure data directory exists
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    // Create users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT CHECK(role IN ('admin', 'user', 'readonly')) NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login TEXT,
        is_active INTEGER DEFAULT 1,
        must_change_password INTEGER DEFAULT 0
      )
    `);
    // Migrate: add must_change_password column to existing databases
    try {
      this.db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0`);
    } catch { /* column already exists — safe to ignore */ }
    // Create connections table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        username TEXT,
        password TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_connections_created_by ON connections(created_by);
    `);

    // ── New feature tables ────────────────────────────────────────────────
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS saved_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        username TEXT,
        password_enc TEXT,
        color TEXT DEFAULT '#0ea5e9',
        description TEXT,
        allowed_roles TEXT DEFAULT '["admin"]',
        ssl_verify INTEGER DEFAULT 1,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        last_connected TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        username TEXT,
        action TEXT NOT NULL,
        target TEXT,
        method TEXT,
        endpoint TEXT,
        request_body TEXT,
        status_code INTEGER,
        duration_ms INTEGER,
        ip_address TEXT,
        cluster_url TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(username);

      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        metric TEXT NOT NULL,
        operator TEXT NOT NULL,
        threshold REAL NOT NULL,
        window_minutes INTEGER DEFAULT 5,
        severity TEXT DEFAULT 'warning',
        channels TEXT DEFAULT '[]',
        connection_id TEXT,
        is_active INTEGER DEFAULT 1,
        last_triggered TEXT,
        trigger_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alert_triggers (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        threshold REAL NOT NULL,
        severity TEXT NOT NULL,
        message TEXT,
        resolved INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_trigger_rule ON alert_triggers(rule_id);
      CREATE INDEX IF NOT EXISTS idx_trigger_created ON alert_triggers(created_at DESC);

      CREATE TABLE IF NOT EXISTS scheduled_reports (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        report_type TEXT NOT NULL,
        format TEXT DEFAULT 'pdf',
        cron_expression TEXT NOT NULL,
        email_to TEXT NOT NULL,
        email_subject TEXT,
        connection_id TEXT,
        is_active INTEGER DEFAULT 1,
        last_run TEXT,
        next_run TEXT,
        last_status TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Check if admin user exists, if not create one
    const adminExists = this.db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin') as { count: number };
    
    if (adminExists.count === 0) {
      this.createDefaultAdmin();
    }

    // Generate the debug-unlock password on first boot (if not already set)
    const debugPwdRow = this.db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get('security_debug_password') as { value: string } | undefined;
    if (!debugPwdRow) {
      this.createDebugPassword();
    }
  }

  /** Generates a random debug-unlock password, stores its bcrypt hash in app_settings,
   *  and prints the plain-text to stdout so the operator can save it.
   *  Called automatically on first boot; can be triggered again via the admin UI. */
  createDebugPassword(): string {
    const plain = randomBytes(10).toString('base64url');   // ~14 printable chars
    const hashed = hashPasswordSync(plain);
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run('security_debug_password', hashed, now);

    console.log(`\n🔐  IndexSphere Debug-Unlock Password`);
    console.log(`   Save this password — it will NOT be shown again.`);
    console.log(`   Debug Password : ${plain}`);
    console.log(`   Use it in Settings → Security → Activate Debug Mode.\n`);
    return plain;
  }

  private createDefaultAdmin(): void {
    // If ADMIN_DEFAULT_PASSWORD is set, use it and don't force a change.
    // Otherwise use the well-known default 'admin' and require change on first login.
    const envPassword = process.env.ADMIN_DEFAULT_PASSWORD;
    const defaultPassword = envPassword || 'admin';
    const mustChange = !envPassword; // force change only when using the built-in default

    const adminUser = {
      id: 'admin-' + Date.now(),
      username: 'admin',
      email: 'admin@indexsphere.com',
      // hashPasswordSync is only used here because we are inside the
      // synchronous constructor chain.  All other code uses async hashPassword.
      password_hash: hashPasswordSync(defaultPassword),
      role: 'admin' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_active: 1,
      must_change_password: mustChange ? 1 : 0,
    };

    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, created_at, updated_at, is_active, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      adminUser.id,
      adminUser.username,
      adminUser.email,
      adminUser.password_hash,
      adminUser.role,
      adminUser.created_at,
      adminUser.updated_at,
      adminUser.is_active,
      adminUser.must_change_password
    );

    if (mustChange) {
      console.log(`\n⚠️  IndexSphere first-run setup`);
      console.log(`   Default admin account created.`);
      console.log(`   Username : admin`);
      console.log(`   Password : admin`);
      console.log(`   → You will be required to change this password on first login.\n`);
    } else {
      console.log(`\n⚠️  IndexSphere first-run setup`);
      console.log(`   Admin account created with ADMIN_DEFAULT_PASSWORD.\n`);
    }
  }

  // User management methods
  async getUsers(): Promise<User[]> {
    const stmt = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map(row => ({
      ...row,
      is_active: Boolean(row.is_active),
      must_change_password: Boolean(row.must_change_password),
    })) as User[];
  }

  async getUserById(id: string): Promise<User | null> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ...row,
      is_active: Boolean(row.is_active),
      must_change_password: Boolean(row.must_change_password),
    } as User;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
    const row = stmt.get(username) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ...row,
      is_active: Boolean(row.is_active),
      must_change_password: Boolean(row.must_change_password),
    } as User;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
    const row = stmt.get(email) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ...row,
      is_active: Boolean(row.is_active),
      must_change_password: Boolean(row.must_change_password),
    } as User;
  }

  async createUser(userData: Omit<User, 'id' | 'created_at' | 'updated_at'>): Promise<User> {
    const id = 'user-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, email, password_hash, role, created_at, updated_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      userData.username,
      userData.email,
      userData.password_hash,
      userData.role,
      now,
      now,
      userData.is_active ? 1 : 0
    );

    return {
      id,
      ...userData,
      created_at: now,
      updated_at: now
    };
  }

  async updateUser(id: string, updates: Partial<Omit<User, 'id' | 'created_at'>>): Promise<User | null> {
    const user = await this.getUserById(id);
    if (!user) return null;

    const now = new Date().toISOString();
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && value !== undefined) {
        updateFields.push(`${key} = ?`);
        if (key === 'is_active' || key === 'must_change_password') {
          updateValues.push(value ? 1 : 0);
        } else {
          updateValues.push(value);
        }
      }
    });

    if (updateFields.length === 0) return user;

    updateFields.push('updated_at = ?');
    updateValues.push(now);
    updateValues.push(id);

    const stmt = this.db.prepare(`
      UPDATE users SET ${updateFields.join(', ')} WHERE id = ?
    `);

    stmt.run(...updateValues);

    return await this.getUserById(id);
  }

  async deleteUser(id: string): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM users WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async verifyPassword(username: string, password: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user || !user.is_active) {
      return null;
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (isValid) {
      const updates: Partial<User> = { last_login: new Date().toISOString() };

      // Transparently upgrade legacy SHA-256 hashes to bcrypt on successful login
      if (!user.password_hash.startsWith('$2b$') && !user.password_hash.startsWith('$2a$')) {
        updates.password_hash = await hashPassword(password);
      }

      await this.updateUser(user.id, updates);
      return await this.getUserById(user.id);
    }

    return null;
  }

  // Connection management methods
  async getConnections(): Promise<Connection[]> {
    const stmt = this.db.prepare('SELECT * FROM connections ORDER BY created_at DESC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map(row => ({
      ...row,
      is_active: Boolean(row.is_active)
    })) as Connection[];
  }

  async getConnectionById(id: string): Promise<Connection | null> {
    const stmt = this.db.prepare('SELECT * FROM connections WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      ...row,
      is_active: Boolean(row.is_active)
    } as Connection;
  }

  async createConnection(connectionData: Omit<Connection, 'id' | 'created_at' | 'updated_at'>): Promise<Connection> {
    const id = 'conn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO connections (id, name, url, username, password, created_by, created_at, updated_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      connectionData.name,
      connectionData.url,
      connectionData.username || null,
      connectionData.password || null,
      connectionData.created_by,
      now,
      now,
      connectionData.is_active ? 1 : 0
    );

    return {
      id,
      ...connectionData,
      created_at: now,
      updated_at: now
    };
  }

  async updateConnection(id: string, updates: Partial<Omit<Connection, 'id' | 'created_at'>>): Promise<Connection | null> {
    const connection = await this.getConnectionById(id);
    if (!connection) return null;

    const now = new Date().toISOString();
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'created_at' && value !== undefined) {
        updateFields.push(`${key} = ?`);
        if (key === 'is_active') {
          updateValues.push(value ? 1 : 0);
        } else {
          updateValues.push(value);
        }
      }
    });

    if (updateFields.length === 0) return connection;

    updateFields.push('updated_at = ?');
    updateValues.push(now);
    updateValues.push(id);

    const stmt = this.db.prepare(`
      UPDATE connections SET ${updateFields.join(', ')} WHERE id = ?
    `);

    stmt.run(...updateValues);

    return await this.getConnectionById(id);
  }

  async deleteConnection(id: string): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM connections WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // Close database connection
  close(): void {
    this.db.close();
  }

  // ── App Settings ────────────────────────────────────────────────────────
  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO app_settings(key, value, updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  getAllSettings(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  // ── Audit Log ───────────────────────────────────────────────────────────
  writeAuditLog(entry: Omit<AuditLogEntry, 'id' | 'created_at'>): void {
    const id = 'audit-' + Date.now() + '-' + randomBytes(4).toString('hex');
    this.db.prepare(`
      INSERT INTO audit_log(id,user_id,username,action,target,method,endpoint,
        request_body,status_code,duration_ms,ip_address,cluster_url,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, entry.user_id ?? null, entry.username ?? null, entry.action,
      entry.target ?? null, entry.method ?? null, entry.endpoint ?? null,
      entry.request_body ?? null, entry.status_code ?? null,
      entry.duration_ms ?? null, entry.ip_address ?? null,
      entry.cluster_url ?? null, new Date().toISOString()
    );
  }

  getAuditLogs(opts: { limit?: number; offset?: number; username?: string; action?: string; from?: string; to?: string } = {}): AuditLogEntry[] {
    const wheres: string[] = [];
    const params: (string | number)[] = [];
    if (opts.username) { wheres.push('username = ?'); params.push(opts.username); }
    if (opts.action)   { wheres.push('action LIKE ?'); params.push(`%${opts.action}%`); }
    if (opts.from)     { wheres.push('created_at >= ?'); params.push(opts.from); }
    if (opts.to)       { wheres.push('created_at <= ?'); params.push(opts.to); }
    const where = wheres.length ? 'WHERE ' + wheres.join(' AND ') : '';
    params.push(opts.limit ?? 200, opts.offset ?? 0);
    return this.db.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params) as AuditLogEntry[];
  }

  countAuditLogs(): number {
    return (this.db.prepare('SELECT COUNT(*) as n FROM audit_log').get() as { n: number }).n;
  }

  // ── Alert Rules ─────────────────────────────────────────────────────────
  getAlertRules(): AlertRule[] {
    return (this.db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all() as Record<string, unknown>[])
      .map(r => ({ ...r, is_active: Boolean(r.is_active) })) as AlertRule[];
  }

  getAlertRuleById(id: string): AlertRule | null {
    const row = this.db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { ...row, is_active: Boolean(row.is_active) } as AlertRule;
  }

  createAlertRule(data: Omit<AlertRule, 'id' | 'created_at' | 'updated_at' | 'trigger_count' | 'last_triggered'>): AlertRule {
    const id = 'alert-' + Date.now() + '-' + randomBytes(4).toString('hex');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO alert_rules(id,name,metric,operator,threshold,window_minutes,severity,
        channels,connection_id,is_active,trigger_count,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)
    `).run(id, data.name, data.metric, data.operator, data.threshold, data.window_minutes,
      data.severity, data.channels, data.connection_id ?? null, data.is_active ? 1 : 0, now, now);
    return this.getAlertRuleById(id)!;
  }

  updateAlertRule(id: string, updates: Partial<AlertRule>): AlertRule | null {
    const rule = this.getAlertRuleById(id);
    if (!rule) return null;
    const now = new Date().toISOString();
    const fields: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'id' || k === 'created_at') continue;
      fields.push(`${k} = ?`);
      vals.push(k === 'is_active' ? (v ? 1 : 0) : v);
    }
    if (!fields.length) return rule;
    fields.push('updated_at = ?'); vals.push(now); vals.push(id);
    this.db.prepare(`UPDATE alert_rules SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return this.getAlertRuleById(id);
  }

  deleteAlertRule(id: string): boolean {
    return this.db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id).changes > 0;
  }

  // ── Alert Triggers ──────────────────────────────────────────────────────
  writeAlertTrigger(data: Omit<AlertTrigger, 'id' | 'created_at' | 'resolved'>): AlertTrigger {
    const id = 'trig-' + Date.now() + '-' + randomBytes(4).toString('hex');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO alert_triggers(id,rule_id,metric,value,threshold,severity,message,resolved,created_at)
      VALUES(?,?,?,?,?,?,?,0,?)
    `).run(id, data.rule_id, data.metric, data.value, data.threshold, data.severity, data.message ?? null, now);
    // bump trigger_count + last_triggered on rule
    this.db.prepare(`UPDATE alert_rules SET trigger_count = trigger_count+1, last_triggered=? WHERE id=?`).run(now, data.rule_id);
    return { id, ...data, resolved: false, created_at: now };
  }

  getAlertTriggers(limit = 100): AlertTrigger[] {
    return (this.db.prepare('SELECT * FROM alert_triggers ORDER BY created_at DESC LIMIT ?').all(limit) as Record<string, unknown>[])
      .map(r => ({ ...r, resolved: Boolean(r.resolved) })) as AlertTrigger[];
  }

  // ── Scheduled Reports ───────────────────────────────────────────────────
  getScheduledReports(): ScheduledReport[] {
    return (this.db.prepare('SELECT * FROM scheduled_reports ORDER BY created_at DESC').all() as Record<string, unknown>[])
      .map(r => ({ ...r, is_active: Boolean(r.is_active) })) as ScheduledReport[];
  }

  getScheduledReportById(id: string): ScheduledReport | null {
    const row = this.db.prepare('SELECT * FROM scheduled_reports WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { ...row, is_active: Boolean(row.is_active) } as ScheduledReport;
  }

  createScheduledReport(data: Omit<ScheduledReport, 'id' | 'created_at' | 'updated_at' | 'last_run' | 'last_status'>): ScheduledReport {
    const id = 'rpt-' + Date.now() + '-' + randomBytes(4).toString('hex');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO scheduled_reports(id,name,report_type,format,cron_expression,
        email_to,email_subject,connection_id,is_active,next_run,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, data.name, data.report_type, data.format, data.cron_expression,
      data.email_to, data.email_subject ?? null, data.connection_id ?? null,
      data.is_active ? 1 : 0, data.next_run ?? null, data.created_by, now, now);
    return this.getScheduledReportById(id)!;
  }

  updateScheduledReport(id: string, updates: Partial<ScheduledReport>): ScheduledReport | null {
    const report = this.getScheduledReportById(id);
    if (!report) return null;
    const now = new Date().toISOString();
    const fields: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'id' || k === 'created_at' || k === 'created_by') continue;
      fields.push(`${k} = ?`);
      vals.push(k === 'is_active' ? (v ? 1 : 0) : v);
    }
    if (!fields.length) return report;
    fields.push('updated_at = ?'); vals.push(now); vals.push(id);
    this.db.prepare(`UPDATE scheduled_reports SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return this.getScheduledReportById(id);
  }

  deleteScheduledReport(id: string): boolean {
    return this.db.prepare('DELETE FROM scheduled_reports WHERE id = ?').run(id).changes > 0;
  }

  // ── Saved Connections (multi-cluster with role-based access) ─────────────
  getSavedConnections(allowedRole?: string): SavedConnection[] {
    const rows = allowedRole
      ? (this.db.prepare(`SELECT * FROM saved_connections WHERE is_active = 1 AND (allowed_roles LIKE ? OR allowed_roles LIKE '%"admin"%') ORDER BY name`).all(`%"${allowedRole}"%`) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM saved_connections ORDER BY name').all() as Record<string, unknown>[]);
    return rows.map(r => ({ ...r, ssl_verify: Boolean(r.ssl_verify), is_active: Boolean(r.is_active) })) as SavedConnection[];
  }

  getSavedConnectionById(id: string): SavedConnection | null {
    const row = this.db.prepare('SELECT * FROM saved_connections WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { ...row, ssl_verify: Boolean(row.ssl_verify), is_active: Boolean(row.is_active) } as SavedConnection;
  }

  createSavedConnection(data: Omit<SavedConnection, 'id' | 'created_at' | 'updated_at' | 'last_connected'>): SavedConnection {
    const id = 'sc-' + Date.now() + '-' + randomBytes(4).toString('hex');
    const now = new Date().toISOString();
    const enc = data.password_enc ? encryptValue(data.password_enc) : null;
    this.db.prepare(`
      INSERT INTO saved_connections(id,name,url,username,password_enc,color,description,
        allowed_roles,ssl_verify,created_by,created_at,updated_at,is_active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, data.name, data.url, data.username ?? null, enc, data.color,
      data.description ?? null, data.allowed_roles, data.ssl_verify ? 1 : 0,
      data.created_by, now, now, data.is_active ? 1 : 0);
    return this.getSavedConnectionById(id)!;
  }

  updateSavedConnection(id: string, updates: Partial<SavedConnection>): SavedConnection | null {
    const conn = this.getSavedConnectionById(id);
    if (!conn) return null;
    const now = new Date().toISOString();
    const fields: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (k === 'id' || k === 'created_at' || k === 'created_by') continue;
      fields.push(`${k} = ?`);
      if (k === 'password_enc' && v) vals.push(encryptValue(v as string));
      else if (k === 'ssl_verify' || k === 'is_active') vals.push(v ? 1 : 0);
      else vals.push(v ?? null);
    }
    if (!fields.length) return conn;
    fields.push('updated_at = ?'); vals.push(now); vals.push(id);
    this.db.prepare(`UPDATE saved_connections SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return this.getSavedConnectionById(id);
  }

  deleteSavedConnection(id: string): boolean {
    return this.db.prepare('DELETE FROM saved_connections WHERE id = ?').run(id).changes > 0;
  }
}

// Singleton instance
let dbInstance: SQLiteDatabase | null = null;

export function getDatabase(): SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = new SQLiteDatabase();
  }
  return dbInstance;
}

export default SQLiteDatabase;
