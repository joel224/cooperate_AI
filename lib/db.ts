import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../drizzle/schema';

const client = createClient({
  // Use a file-based URL for local development
  url: 'file:sqlite.db',
});

export const db = drizzle(client, { schema });

// Note: With the libsql driver, migrations are typically run via the Drizzle Kit CLI,
// which is a more robust approach for production.
// Run `npx drizzle-kit push:sqlite` to apply schema changes.