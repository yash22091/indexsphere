// This module is a re-export shim so all existing "@/lib/database" imports
// continue to work. The canonical implementation is database-sqlite.ts.
export {
  getDatabase,
  hashPassword,
  hashPasswordSync,
  verifyPassword,
  type User,
  type Connection,
} from './database-sqlite';
