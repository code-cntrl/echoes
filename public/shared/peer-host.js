// The home-base side of phone-to-phone sync. A linked phone sends small JSON messages over a
// direct connection; this answers them with the same core rules the hub uses. It knows nothing
// about WebRTC, so it can be tested with plain function calls.
import { HttpError, isActive, publicMember } from './core.js';

// A linked phone acts for one person only. Signing in, setting up and backups stay on the home base.
const BLOCKED = [
  ['POST', /^\/api\/(setup|setup-restore|login|logout|restore|join|invites)$/],
  ['GET', /^\/api\/backup$/],
];

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const MAX_OPS = 1000; // remembered change ids; a phone's queue is far shorter

export function randomKey() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashKey(key) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(key)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A linked phone must not hand its key to a look-alike "home base" (a modified copy of the app
// would get it, and could then sync as that person). So before sending it, the phone asks the home
// base to prove it knows the link: the phone sends linkId (a hash of the hash the home base keeps)
// and a random nonce, and only the real home base can answer with linkProof.
export const linkId = async (key) => hashKey(await hashKey(key));
export async function linkProof(keyHash, nonce) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyHash), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(nonce))));
}

const errorReply = (id, e) => {
  if (!(e instanceof HttpError) && !e?.status) throw e;
  return { t: 'res', id, ok: false, status: e.status, error: e.message, extra: e.extra || {} };
};

/**
 * @param {object} o
 * @param {ReturnType<import('./core.js').createCore>} o.core
 * @param {ReturnType<import('./store.js').createDocStore>} o.store
 */
export function createPeerHost({ core, store, now = () => new Date() }) {
  const peers = () => store.raw().hub.peers;

  // A random id for this family, so a phone can tell "linked again to the same family" apart.
  async function familyId() {
    let id = store.getSetting('familyId', null);
    if (!id) {
      id = randomKey().slice(0, 16);
      await store.setSetting('familyId', id);
    }
    return id;
  }

  async function link(memberId, oldKey = null) {
    const member = store.getMember(memberId);
    if (!member || !isActive(member)) throw new HttpError(404, 'That person isn’t in the family any more.');
    // A phone linked again replaces its old link, so it isn't listed twice.
    if (typeof oldKey === 'string' && oldKey) delete peers()[await hashKey(oldKey)];
    const key = randomKey();
    peers()[await hashKey(key)] = { memberId: member.id, linkedAt: now().toISOString(), lastSyncAt: now().toISOString() };
    await store.save();
    return { key, member };
  }

  async function authenticate(key) {
    const entry = typeof key === 'string' && key.length >= 40 ? peers()[await hashKey(key)] : null;
    const member = entry && store.getMember(entry.memberId);
    if (!member) throw new HttpError(401, 'This phone isn’t linked to this family any more. Ask a parent to link it again.');
    if (!isActive(member)) throw new HttpError(403, 'This guest pass has ended. Ask a parent to extend it.');
    entry.lastSyncAt = now().toISOString();
    await store.save();
    return member;
  }

  /**
   * One connection. mode 'link' links the phone to `memberId` (started by a parent on the home base,
   * with that person's PIN if they have one); mode 'sync' only accepts a phone that is already linked.
   */
  function session({ mode, memberId = null, by = null, pin = null }) {
    if (mode === 'link') {
      const parent = by && store.getMember(by);
      if (!parent?.isParent) throw new HttpError(403, 'Only parents can link a phone.');
    }
    let meId = null;
    let used = false;

    async function handle(msg) {
      if (!msg || typeof msg !== 'object') return null;
      // The phone checks this is its home base before it sends its key (see linkProof).
      if (msg.t === 'challenge') {
        const nonce = typeof msg.nonce === 'string' && /^[A-Za-z0-9_-]{22,86}$/.test(msg.nonce) ? msg.nonce : null;
        const id = typeof msg.id === 'string' && /^[0-9a-f]{64}$/.test(msg.id) ? msg.id : null;
        if (nonce && id) {
          for (const keyHash of Object.keys(peers())) {
            if ((await hashKey(keyHash)) === id) return { t: 'proof', proof: await linkProof(keyHash, nonce) };
          }
        }
        return { t: 'proof', proof: null };
      }
      if (msg.t === 'hello') {
        if (used) return { t: 'denied', error: 'Already connected.' };
        // Linking: first tell the phone whose it would become, so a wrong tap on the home base
        // doesn't silently show someone else's messages on it. It says hello again with accept.
        if (mode === 'link' && !msg.accept) {
          const member = store.getMember(memberId);
          if (!member || !isActive(member)) return { t: 'denied', status: 404, error: 'That person isn’t in the family any more.' };
          return { t: 'confirm', member: publicMember(member), family: core.state(member).family };
        }
        used = true;
        try {
          let key = null;
          let member;
          if (mode === 'link') {
            // Linking puts someone's messages on a phone: if they have a PIN, it's needed, so a parent
            // can't quietly link a phone to a teenager's inbox.
            const target = store.getMember(memberId);
            if (target?.pinHash) await core.verifyPin(target, pin);
            ({ key, member } = await link(memberId, msg.key));
          }
          else member = await authenticate(msg.key);
          meId = member.id;
          return { t: 'ready', key, member: publicMember(member), family: core.state(member).family, familyId: await familyId() };
        } catch (e) {
          if (!(e instanceof HttpError)) throw e;
          return { t: 'denied', status: e.status, error: e.message };
        }
      }
      if (msg.t === 'req') {
        const id = msg.id;
        try {
          const me = meId && store.getMember(meId);
          if (!me) throw new HttpError(401, 'Please sync again.');
          const method = String(msg.method || '').toUpperCase();
          const path = String(msg.path || '');
          if (BLOCKED.some(([m, re]) => m === method && re.test(path))) throw new HttpError(403, 'Do that on the home base.');
          // A change sent again after its reply was lost (op = the phone's random id for it) is
          // not applied twice. Only the random id is kept: no person, time or result, so it can't
          // tie anyone to an anonymous message.
          const op = method !== 'GET' && typeof msg.op === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(msg.op) ? msg.op : null;
          const ops = store.raw().hub.ops;
          if (op && ops[op]) return { t: 'res', id, ok: true, data: { ok: true, duplicate: true } };
          // viaSync: anonymous messages from a synced phone are held back for a while (see core).
          const ctx = { me, viaSync: true, signIn: () => {}, signOut: () => {} };
          const data = await core.handle(method, path, msg.body ?? {}, ctx);
          if (op) {
            ops[op] = 1;
            const keys = Object.keys(ops);
            for (const k of keys.slice(0, Math.max(0, keys.length - MAX_OPS))) delete ops[k];
            await store.save();
          }
          return { t: 'res', id, ok: true, data };
        } catch (e) {
          return errorReply(id, e);
        }
      }
      return null;
    }

    return { handle, get memberId() { return meId; } };
  }

  return { session, link, authenticate };
}
