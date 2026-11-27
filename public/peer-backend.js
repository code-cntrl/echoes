// Linked-phone mode: this phone belongs to one person and syncs with the family's home base
// phone when they're together. It keeps a copy of its own inbox and a queue in IndexedDB.
import { openDb, tx } from './local-backend.js';
import { createPeerClient } from './shared/peer-client.js';

const KEY = 'peer';

export async function createPeerBackend() {
  const db = await openDb();
  navigator.storage?.persist?.().catch(() => {});
  const client = await createPeerClient({
    storage: {
      load: () => tx(db, 'readonly', (s) => s.get(KEY)),
      save: (rec) => tx(db, 'readwrite', (s) => s.put(structuredClone(rec), KEY)),
    },
  });

  async function api(method, path, body) {
    try {
      return await client.api(method, path, body ?? {});
    } catch (e) {
      if (!e.status) throw e;
      const err = new Error(e.message);
      err.status = e.status;
      err.offline = !!e.offline;
      err.data = { error: e.message, ...(e.extra || {}) };
      throw err;
    }
  }
  return { api, client };
}
