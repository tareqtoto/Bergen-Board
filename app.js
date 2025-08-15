// ==== Configuration ====
const DEFAULT_PROXY = "https://entur-proxy.fwmh6w8pfj.workers.dev";
const urlParams = new URLSearchParams(location.search);
const PROXY_BASE = (urlParams.get("proxy") || DEFAULT_PROXY).replace(/\/+$/, "");
const ENDPOINTS = [PROXY_BASE + "/v3", PROXY_BASE + "/v2"]; // v3 then v2

// Fallback StopPlaces for Bergen busstasjon (bus + Bybanen)
const FALLBACK_STOP_IDS = [
  "NSR:StopPlace:30810",
  "NSR:StopPlace:62129",
  "NSR:StopPlace:62356"
];

const REFRESH_MS    = 15000;
const RANGE_SECONDS = 6 * 3600;  // 6 hours
const PER_FETCH     = 120;       // departures per quay

// ==== Small helpers ====
const $    = function (s) { return document.querySelector(s); };
const pad2 = function (n) { return (n < 10 ? "0" + n : "" + n); };
const fmt  = function (d) { var t = new Date(d); return pad2(t.getHours()) + ":" + pad2(t.getMinutes()); };
const mins = function (d) { return Math.max(0, Math.round((new Date(d) - Date.now()) / 60000)); };
function readLines(){
  var raw = $("#exactFilter").value.trim();
  return raw ? raw.split(",").map(function (s){ return s.trim().toUpperCase(); }).filter(Boolean) : null;
}

// ==== Geocoder via Worker (/gc) ====
async function findStopPlaces(){
  var u = new URL(PROXY_BASE + "/gc");
  u.searchParams.set("text", "Bergen busstasjon");
  u.searchParams.set("lang", "no");
  u.searchParams.set("size", "20");
  u.searchParams.set("focus.point.lat", "60.389");
  u.searchParams.set("focus.point.lon", "5.333");

  try {
    var res = await fetch(u.toString(), { method: "GET" });
    var js  = await res.json();
    var found = [];
    (js.features || []).forEach(function (f){
      var id = (f && f.properties && f.properties.id) || "";
      if (id.indexOf("NSR:StopPlace:") === 0 && found.indexOf(id) === -1) found.push(id);
    });
    var merged = Array.from(new Set([].concat(found.slice(0,8), FALLBACK_STOP_IDS)));
    return merged.length ? merged : FALLBACK_STOP_IDS.slice();
  } catch (e) {
    console.warn("Geocoder via proxy failed:", e);
    return FALLBACK_STOP_IDS.slice();
  }
}

// ==== GraphQL ====
var GQL_SP =
  "query($id:ID!,$per:Int!,$range:Int!){" +
  "  stopPlace(id:$id){" +
  "    id name " +
  "    quays{" +
  "      id publicCode name " +
  "      estimatedCalls(timeRange:$range, numberOfDepartures:$per){" +
  "        expectedDepartureTime realtime aimedDepartureTime destinationDisplay{frontText} " +
  "        quay{id publicCode name} " +
  "        serviceJourney{journeyPattern{line{id publicCode name transportMode}}}" +
  "      }" +
  "    }" +
  "  }" +
  "}";

async function gql(query, variables){
  var lastErr = null;
  for (var i=0; i<ENDPOINTS.length; i++){
    var url = ENDPOINTS[i];
    try{
      var res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query, variables: variables })
      });
      var js = await res.json();
      if (!js.errors) return js;
      lastErr = new Error((js.errors[0] && js.errors[0].message) || "GraphQL error");
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("All endpoints failed");
}

function buildRowsFromStopPlace(sp){
  var rows = [];
  var quays = (sp && sp.quays) || [];
  for (var qi=0; qi<quays.length; qi++){
    var q = quays[qi];
    var calls = (q && q.estimatedCalls) || [];
    for (var ci=0; ci<calls.length; ci++){
      var c = calls[ci];
      var line = (c && c.serviceJourney && c.serviceJourney.journeyPattern && c.serviceJourney.journeyPattern.line) || {};
      rows.push({
        t: c && c.expectedDepartureTime,
        in: mins(c && c.expectedDepartureTime),
        line: (line.publicCode || line.name || "").toUpperCase(),
        dest: ((c && c.destinationDisplay && c.destinationDisplay.frontText) || "").trim(),
        stop: (q && q.publicCode) ? ("Perrong " + q.publicCode) : ((q && q.name) || "—"),
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

  // 1) Find relevant StopPlace IDs via Worker → Geocoder
  var stopIds = await findStopPlaces();

  // 2) Fetch departures for each StopPlace
  var allRows = [];
  var spCount = 0, totalQuays = 0, errors = [];

  for (var i=0; i<stopIds.length; i++){
    var id = stopIds[i];
    try{
      var js = await gql(GQL_SP, { id: id, per: PER_FETCH, range: RANGE_SECONDS });
      var sp = js && js.data && js.data.stopPlace;
      if (sp){
        spCount++;
        totalQuays += ((sp.quays || []).length);
        allRows = allRows.concat(buildRowsFromStopPlace(sp));
      }
    }catch(e){ errors.push(id + ": " + (e.message || e)); }
  }

  // 3) Apply filters
  var showBus = $("#busToggle").checked;
  var showTram = $("#tramToggle").checked;
  var exact = readLines();

  var rows = allRows
    .filter(function(r){ return r.t; })
    .filter(function(r){ return (r.mode !== "TRAM" || showTram) && (r.mode !== "BUS" || showBus); });

  if (exact && exact.length) rows = rows.filter(function(r){ return exact.indexOf(r.line) !== -1; });

  // 4) Sort and render
  rows.sort(function(a,b){ return new Date(a.t) - new Date(b.t); });
  render(rows);

  // 5) Status + Debug
  $("#status").textContent = "Loaded";
  $("#ts").textContent = new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  $("#debug").style.display = "block";
  $("#debug").innerHTML =
    "<strong>Debug:</strong> proxy=" + PROXY_BASE +
    " • stopIds=" + stopIds.join(", ") +
    " • stopPlaces=" + spCount +
    " • quays=" + totalQuays +
    " • rows=" + rows.length +
    (errors.length ? "<br>Errors: " + errors.join(" | ") : "");
}

function render(rows){
  var host = document.getElementById("rows");
  host.innerHTML = "";
  if (!rows.length){
    var r = document.createElement("div");
    r.className = "trow";
    r.innerHTML = '<div class="cell time">—</div><div class="cell in">—</div><div class="cell line"><span style="color:#6b7280">No upcoming departures</span></div><div class="cell dest"></div><div class="cell stop"></div><div class="cell mode"></div>';
    host.appendChild(r);
    return;
  }
  for (var i=0; i<rows.length; i++){
    var row = rows[i];
    var el = document.createElement("div");
    el.className = "trow";
    el.innerHTML =
      '<div class="cell time">' + fmt(row.t) + '</div>' +
      '<div class="cell in">' + row.in + ' min</div>' +
      '<div class="cell line"><span class="line-pill">' + row.line + '</span></div>' +
      '<div class="cell dest">' + row.dest + '</div>' +
      '<div class="cell stop">' + row.stop + '</div>' +
      '<div class="cell mode">' + (row.mode === "TRAM" ? "Bybanen" : "Bus") + '</div>';
    host.appendChild(el);
  }
}

// Start when DOM is ready
window.addEventListener("DOMContentLoaded", function (){
  document.getElementById("busToggle").addEventListener("change", load);
  document.getElementById("tramToggle").addEventListener("change", load);
  document.getElementById("exactFilter").addEventListener("change", load);
  load();
  setInterval(load, REFRESH_MS);
});
