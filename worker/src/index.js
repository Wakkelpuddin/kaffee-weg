// Live-Abstimmung für "Der Weg bis zur Tasse": zählt Stimmen + Simulator-Ergebnisse.
const POLLS = { p1: 4, p2: 4 };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export class Room {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS v (k TEXT PRIMARY KEY, n INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS s (id INTEGER PRIMARY KEY AUTOINCREMENT, fair REAL, cup REAL, farmer REAL)');
  }
  state() {
    const votes = {};
    for (const p in POLLS) votes[p] = Array(POLLS[p]).fill(0);
    for (const r of this.sql.exec('SELECT k, n FROM v').toArray()) {
      const [p, o] = r.k.split(':');
      if (votes[p] && votes[p][+o] !== undefined) votes[p][+o] = r.n;
    }
    const a = this.sql.exec('SELECT COUNT(*) AS n, AVG(fair) AS fair, AVG(cup) AS cup, AVG(farmer) AS farmer FROM s').one();
    const st = this.sql.exec("SELECT v FROM kv WHERE k = 'stage'").toArray()[0];
    const rd = this.sql.exec("SELECT v FROM kv WHERE k = 'round'").toArray()[0];
    return { round: rd ? rd.v : '0', stage: st ? JSON.parse(st.v) : null, votes, sim: { n: a.n, fair: a.fair || 0, cup: a.cup || 0, farmer: a.farmer || 0 } };
  }
  async fetch(req) {
    const p = new URL(req.url).pathname;
    if (req.method === 'POST' && p === '/vote') {
      const b = await req.json().catch(() => ({}));
      const o = Number(b.opt);
      if (!(b.poll in POLLS) || !Number.isInteger(o) || o < 0 || o >= POLLS[b.poll]) return json({ err: 'bad' }, 400);
      this.sql.exec('INSERT INTO v (k, n) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET n = n + 1', b.poll + ':' + o);
    } else if (req.method === 'POST' && p === '/sim') {
      const b = await req.json().catch(() => ({}));
      const f = Number(b.fair), c = Number(b.cup), fa = Number(b.farmer);
      if (![f, c, fa].every(Number.isFinite) || f < 0 || f > 100 || c < 0 || c > 1 || fa < 0 || fa > 10) return json({ err: 'bad' }, 400);
      this.sql.exec('INSERT INTO s (fair, cup, farmer) VALUES (?, ?, ?)', f, c, fa);
    } else if (req.method === 'POST' && p === '/stage') {
      const b = await req.json().catch(() => ({}));
      if (typeof b.scene !== 'string' || b.scene.length > 20 || !Number.isInteger(b.sub)) return json({ err: 'bad' }, 400);
      this.sql.exec("INSERT INTO kv (k, v) VALUES ('stage', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", JSON.stringify({ scene: b.scene, sub: b.sub, src: b.src === 'remote' ? 'remote' : 'tafel', t: Date.now() }));
    } else if (req.method === 'POST' && p === '/reset') {
      this.sql.exec('DELETE FROM v'); this.sql.exec('DELETE FROM s'); this.sql.exec('DELETE FROM kv');
      this.sql.exec("INSERT INTO kv (k, v) VALUES ('round', ?)", String(Date.now()));
    }
    return json(this.state());
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(req.url);
    if (['/reset', '/stage'].includes(u.pathname) && u.searchParams.get('key') !== env.RESET_KEY) return json({ err: 'forbidden' }, 403);
    if (!['/state', '/vote', '/sim', '/reset', '/stage'].includes(u.pathname)) return json({ err: 'not found' }, 404);
    const stub = env.ROOM.get(env.ROOM.idFromName('klasse-v3'));
    return stub.fetch(req);
  },
};
