// 鸭鸭大赛跑 — 实时服务器（Render 免费版可用）
// 大屏幕： https://你的网址/host     手机： https://你的网址/
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || "";      // 可选：在 Render 设置主持人密码
const SHEET_URL = process.env.SHEET_URL || "";    // 可选：Google Sheet 结果记录的 Apps Script 网址
const SHEET_KEY = process.env.SHEET_KEY || "";
const MAX_PLAYERS = 120;
const MAX_TAPS_PER_SEC = 15;                      // 防连点器

// index.html 放在 public/ 里或直接放在最外层都可以
const pagePath = [path.join(__dirname, "public", "index.html"), path.join(__dirname, "index.html")].find(p => fs.existsSync(p));
if (!pagePath) { console.error("找不到 index.html：请把 index.html 上传到仓库最外层或 public 文件夹"); process.exit(1); }
const page = fs.readFileSync(pagePath);
const qrjs = fs.readFileSync(require.resolve("qrcode-generator/qrcode.js"));
const server = http.createServer((req, res) => {
  const u = (req.url || "/").split("?")[0];
  if (u === "/healthz") { res.writeHead(200); res.end("ok"); return; }
  if (u === "/qrcode.js") { res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "max-age=86400" }); res.end(qrjs); return; }
  if (u === "/" || u === "/host" || u === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(page); return;
  }
  res.writeHead(404); res.end("not found");
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });

const G = { phase: "lobby", goal: 120, countEnd: 0, rid: 0, rank: [], finT: {} };
const players = new Map();   // pid -> player
const hosts = new Set();
let seq = 0, rosterVer = 1;
const now = () => Date.now();
const clean = s => String(s == null ? "" : s).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 10) || "鸭鸭";
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const racing = () => (G.phase === "count" || G.phase === "go") && now() >= G.countEnd;
const inRace = p => p.rid === G.rid && G.rid > 0;

wss.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== "object") return;

    if (m.t === "hello-host") {
      if (HOST_PIN && String(m.pin || "") !== HOST_PIN) { send(ws, { t: "pin-bad" }); return; }
      ws.role = "host"; hosts.add(ws); ws.rosterSent = 0;
      send(ws, { t: "host-ok", sheet: !!SHEET_URL }); return;
    }
    if (m.t === "host" && ws.role === "host") { hostAction(m); return; }

    if (m.t === "join") {
      const pid = String(m.pid || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
      if (!pid) return;
      let p = players.get(pid);
      if (!p) {
        if (players.size >= MAX_PLAYERS) { send(ws, { t: "full" }); return; }
        p = { pid, id: ++seq, taps: 0, rid: -1, bucket: 5, last: now() };
        players.set(pid, p);
      }
      if (p.ws && p.ws !== ws) { try { p.ws.close(); } catch (e) {} }
      p.name = clean(m.name); p.color = Math.abs(parseInt(m.color, 10) || 0) % 8;
      p.ws = ws; p.leftAt = 0; ws.role = "player"; ws.pid = pid;
      rosterVer++; sendYou(p); return;
    }
    if (m.t === "tap" && ws.role === "player") {
      const p = players.get(ws.pid); if (p && p.ws === ws) tap(p); return;
    }
    if (m.t === "leave" && ws.role === "player") {
      players.delete(ws.pid); ws.role = null; rosterVer++; return;
    }
  });
  ws.on("close", () => {
    hosts.delete(ws);
    if (ws.role === "player") {
      const p = players.get(ws.pid);
      if (p && p.ws === ws) { p.ws = null; p.leftAt = now(); rosterVer++; }
    }
  });
});

function tap(p) {
  if (!racing() || !inRace(p) || p.taps >= G.goal) return;
  const t = now();
  p.bucket = Math.min(5, p.bucket + (t - p.last) / 1000 * MAX_TAPS_PER_SEC); p.last = t;
  if (p.bucket < 1) return;
  p.bucket -= 1; p.taps++;
  if (p.taps >= G.goal) {
    G.rank.push(p.pid); G.finT[p.pid] = t - G.countEnd;
    sendYou(p);
    const racers = [...players.values()].filter(inRace);
    if (racers.every(r => r.taps >= G.goal)) finish();
  }
}

function hostAction(m) {
  const a = m.a;
  if (a === "goal" && (G.phase === "lobby" || G.phase === "done")) {
    const g = parseInt(m.goal, 10); if (g >= 10 && g <= 500) G.goal = g;
  } else if (a === "start" && G.phase !== "count" && G.phase !== "go") {
    const online = [...players.values()].filter(p => p.ws);
    if (!online.length) return;
    G.rid++; G.phase = "count"; G.countEnd = now() + 3500; G.rank = []; G.finT = {};
    for (const p of online) { p.rid = G.rid; p.taps = 0; p.bucket = 3; p.last = G.countEnd; }
    setTimeout(() => { if (G.phase === "count") G.phase = "go"; }, 3500);
  } else if (a === "end") {
    finish();
  } else if (a === "lobby") {
    G.phase = "lobby"; G.rank = []; G.finT = {};
  } else if (a === "clear") {
    for (const p of players.values()) send(p.ws, { t: "kicked" });
    players.clear(); rosterVer++;
    G.phase = "lobby"; G.rank = []; G.finT = {};
  }
  pushAllYou();
}
function finish() {
  if (G.phase !== "count" && G.phase !== "go") return;
  G.phase = "done"; pushAllYou();
  saveResults();
}

// 每局结束，把结果写进 Google Sheet（有设 SHEET_URL 才会写）
let lastSave = "";
async function saveResults() {
  if (!SHEET_URL) return;
  const racers = [...players.values()].filter(inRace);
  const done = G.rank.map(pid => players.get(pid)).filter(Boolean);
  const rest = racers.filter(p => G.rank.indexOf(p.pid) < 0).sort((a, b) => b.taps - a.taps);
  const rows = done.concat(rest).map((p, i) => ({
    rank: i + 1, name: p.name, taps: p.taps, finished: G.rank.indexOf(p.pid) >= 0,
    seconds: G.finT[p.pid] != null ? +(G.finT[p.pid] / 1000).toFixed(2) : ""
  }));
  if (!rows.length) return;
  const body = JSON.stringify({ key: SHEET_KEY, time: now(), round: G.rid, goal: G.goal, rows });
  lastSave = "saving";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(SHEET_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, redirect: "follow" });
      const txt = await r.text();
      let j = {}; try { j = JSON.parse(txt); } catch (e) {}
      if (j.ok) { lastSave = "ok"; console.log("结果已存进 Google Sheet：" + rows.length + " 行"); broadcastSave(); return; }
      console.error("Google Sheet 回应：" + txt.slice(0, 200));
    } catch (e) { console.error("存 Google Sheet 失败（第 " + attempt + " 次）：" + e.message); }
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }
  lastSave = "fail"; broadcastSave();
}
function broadcastSave() { for (const h of hosts) send(h, { t: "saved", ok: lastSave === "ok" }); }

function positions() {
  const racers = [...players.values()].filter(inRace);
  racers.sort((a, b) => {
    const ra = G.rank.indexOf(a.pid), rb = G.rank.indexOf(b.pid);
    if (ra >= 0 || rb >= 0) return (ra < 0 ? 1e9 : ra) - (rb < 0 ? 1e9 : rb);
    return b.taps - a.taps;
  });
  const pos = new Map(); racers.forEach((p, i) => pos.set(p.pid, i + 1));
  return { pos, total: racers.length };
}
function sendYou(p, P) {
  if (!p.ws) return;
  P = P || positions();
  const online = [...players.values()].filter(x => x.ws).length;
  send(p.ws, {
    t: "y", now: now(), phase: G.phase, goal: G.goal, countEnd: G.countEnd, rid: G.rid,
    in: inRace(p), taps: inRace(p) ? p.taps : 0, fin: G.rank.indexOf(p.pid) + 1,
    pos: P.pos.get(p.pid) || 0, total: P.total, count: online
  });
}
function pushAllYou() { const P = positions(); for (const p of players.values()) sendYou(p, P); }

// 大屏幕：每秒 20 帧
setInterval(() => {
  if (!hosts.size) return;
  const list = [...players.values()];
  const frame = JSON.stringify({
    t: "f", now: now(), phase: G.phase, goal: G.goal, countEnd: G.countEnd, rid: G.rid,
    online: list.filter(p => p.ws).length,
    d: list.filter(inRace).map(p => [p.id, p.taps]),
    rank: G.rank.map(pid => { const p = players.get(pid); return p ? [p.id, G.finT[pid]] : null; }).filter(Boolean)
  });
  let roster = null;
  for (const h of hosts) {
    if (h.readyState !== 1) continue;
    if (h.rosterSent !== rosterVer) {
      roster = roster || JSON.stringify({ t: "roster", list: list.map(p => [p.id, p.name, p.color, p.ws ? 1 : 0]) });
      h.send(roster); h.rosterSent = rosterVer;
    }
    h.send(frame);
  }
}, 50);

// 手机：每秒 5 次更新
setInterval(pushAllYou, 200);

// 断线清理 + 保持连线
setInterval(() => {
  const t = now();
  for (const [pid, p] of players) {
    const keep = (G.phase === "count" || G.phase === "go") && inRace(p) ? 60000 : 10000;
    if (!p.ws && t - p.leftAt > keep) { players.delete(pid); rosterVer++; }
  }
}, 1000);
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; try { ws.ping(); } catch (e) {}
  }
}, 25000);

server.listen(PORT, () => console.log("鸭鸭大赛跑 running on port " + PORT));
