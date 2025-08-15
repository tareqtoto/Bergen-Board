// ==== Configuration ====
const DEFAULT_PROXY = "https://entur-proxy.fwmh6w8pfj.workers.dev"; // your Worker URL
const urlParams = new URLSearchParams(location.search);
const PROXY_BASE = (urlParams.get("proxy") || DEFAULT_PROXY).replace(/\/+$/, "");
const ENDPOINTS = [PROXY_BASE + "/v3", PROXY_BASE + "/v2"]; // v3, then v2 fallback

// Bergen busstasjon stop places (bus + Bybanen)
const STOP_IDS = [
  "NSR:StopPlace:30810", // Busstasjon (bus)
  "NSR:StopPlace:62129", // alternate bus id
  "NSR:StopPlace:62356"  // Bybanen at busstasjon
];

const REFRESH_MS   = 15000;
const RANGE_SECONDS = 6 * 3600;  // 6 hours
const PER_FETCH     = 120;       // number of departures per quay

// ==== Small helpers ====
const $    = (s) => document.querySelector(s);
const pad2 = (n) => (n < 10 ? "0" + n : "" + n);
const fmt  = (d) => { const t = new Date(d); return pad2(t.getHours()) + ":" + pad2(t.getMinutes()); };
const mins = (d) => Math.max(0, Math.round((new Date(d) - Date.now()) / 60000));
function readLines(){ const raw = $("#exactFilter").value.trim(); return raw ? raw.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean) : null; }

// ==== GraphQL ====
const GQL_SP = `
query($id:ID!,$per:Int!,$range:Int!){
  stopPlace(id:$id){
    id name
    quays{
      id publicCode name
      estimatedCalls(timeRange:$range, numberOfDepartures:$per){
        expectedDepartureTime realtime aimedDepartureTime destinationDisplay{frontText}
        quay{id publicCode name}
        serviceJourney{journeyPattern{line{id publicCode name transportMode}}}
      }
    }
  }
}`;

async function gql(query, variables){
  let lastErr = null;
  for (const url of ENDPOINTS){
    try{
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables })
      });
      const js = await res.json();
      if (!js.errors) return js;
      lastErr = new Error(js.errors[0]?.message || "GraphQL error");
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("All endpoints failed");
}

function buildRowsFromStopPlace(sp){
  const rows = [];
  const quays = sp?.quays || [];
  for (const q of quays){
    const calls = q?.estimatedCalls || [];
    for (const c of calls){
      const line = c?.serviceJourney?.journeyPattern?.line || {};
      rows.push({
        t: c?.expectedDepartureTime,
        in: mins(c?.expectedDepartureTime),
        line: (line.publicCode || line.name || "").toUpperCase(),
        dest: (c?.destinationDisplay?.frontText || "").trim(),
        stop: q?.publicCode ? `Perrong ${q.publicCode}` : (q?.name || "—"),
        mode: (line.transportMode || "").toUpperCase()
      });
    }
  }
  return rows;
}

async function load(){
  $("#status").textContent = "Fetching via proxy…";
  $("#error").style.display = "none";
  $("#debug").style.display = "none";

  const allRows = [];
  let spCount = 0, totalQuays = 0, errors = [];

  for (const id of STOP_IDS){
    try{
      const js = await gql(GQL_SP, { id, per: PER_FETCH, range: RANGE_SECONDS });
      const sp = js?.data?.stopPlace;
      if (sp){
        spCount++;
        totalQuays += (sp.quays || []).length;
        allRows.push(...buildRowsFromStopPlace(sp));
      }
    }catch(e){ errors.push(id + ": " + (e.message || e)); }
  }

  const showBus = $("#busToggle").checked;
  const showTram = $("#tramToggle").checked;
  const exact = readLines();

  let rows = allRows
    .filter(r => r.t)
    .filter(r => (r.mode !== "TRAM" || showTram) && (r.mode !== "BUS" || showBus));

  if (exact && exact.length) rows = rows.filter(r => exact.includes(r.line));

  rows.sort((a,b) => new Date(a.t) - new Date(b.t));
  render(rows);

  $("#status").textContent = "Loaded";
  $("#ts").textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  $("#debug").style.display = "block";
  $("#debug").innerHTML = `<strong>Debug:</strong> proxy=${PROXY_BASE} • stopPlaces=${spCount} • quays=${totalQuays} • rows=${rows.length}` +
                          (errors.length ? `<br>Errors: ${errors.join(" | ")}` : "");
}

function render(rows){
  const host = document.getElementById("rows");
  host.innerHTML = "";
  if (!rows.length){
    const r = document.createElement("div");
    r.className = "trow";
    r.innerHTML = '<div class="cell time">—</div><div class="cell in">—</div><div class="cell line"><span style="color:#6b7280">No upcoming departures</span></div><div class="cell dest"></div><div class="cell stop"></div><div class="cell mode"></div>';
    host.appendChild(r);
    return;
  }
  for (const row of rows){
    const el = document.createElement("div");
    el.className = "trow";
    el.innerHTML = `
      <div class="cell time">${fmt(row.t)}</div>
      <div class="cell in">${row.in} min</div>
      <div class="cell line"><span class="line-pill">${row.line}</span></div>
      <div class="cell dest">${row.dest}</div>
      <div class="cell stop">${row.stop}</div>
      <div class="cell mode">${row.mode === "TRAM" ? "Bybanen" : "Bus"}</div>`;
    host.appendChild(el);
  }
}

// Start once DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("busToggle").addEventListener("change", load);
  document.getElementById("tramToggle").addEventListener("change", load);
  document.getElementById("exactFilter").addEventListener("change", load);
  load();
  setInterval(load, REFRESH_MS);
});
