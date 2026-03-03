/* =========================
   CONFIG
   ========================= */

// Mets ici TON lien CSV publié (Google Sheets → Fichier → Partager → Publier sur le web → CSV)
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vT06-_3FTfDKYLKEqPhdRTGly_A9LxGO_wbNdilX94_kNgr_gspgSIxSn-1XsPYEv123bN2zmdUUhRA/pub?gid=0&single=true&output=csv";

// Valeur par défaut si la colonne "minutes" est vide/absente
const DEFAULT_MINUTES = 5;

// Séparateur pour tes étiquettes dans la colonne "phrase"
const TOKEN_SEPARATOR = "/";

/* =========================
   ÉTAT + DOM
   ========================= */

const $ = (sel) => document.querySelector(sel);

const ui = {
  timer: $("#timer"),
  progress: $("#progress"),
  desk: $("#desk"),
  overlayPick: $("#overlayPick"),
  pickGrid: $("#pickGrid"),
  overlayStage: $("#overlayStage"),
  stageTitle: $("#stageTitle"),
  stageHint: $("#stageHint"),
  btnNext: $("#btnNext"),
  btnFullscreen: $("#btnFullscreen"),
  doneLabel: $("#doneLabel"),
};

const state = {
  dataByStudent: new Map(), // eleve -> [{tokens, minutes}]
  currentStudent: null,
  currentList: [],
  idx: 0,
  remainingSec: 0,
  timerId: null,
  stage: "pick", // pick | running | stage | done
  zTop: 10,
};

/* =========================
   UTILITAIRES
   ========================= */

function pad2(n){ return String(n).padStart(2, "0"); }
function formatTime(sec){
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}
function shuffleInPlace(arr){
  for(let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

function clearDesk(){
  ui.desk.innerHTML = "";
}

function setProgressText(){
  const total = state.currentList.length || 0;
  if(!total){
    ui.progress.textContent = "—";
    return;
  }
  ui.progress.textContent = `${state.idx + 1}/${total}`;
}

function showPickOverlay(show){
  ui.overlayPick.classList.toggle("hidden", !show);
}
function showStageOverlay(show){
  ui.overlayStage.classList.toggle("hidden", !show);
}

function requestFullscreen(){
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
}
function updateFullscreenButton(){
  const isFs = !!document.fullscreenElement;
  ui.btnFullscreen.classList.toggle("hidden", isFs);
}

ui.btnFullscreen.addEventListener("click", () => {
  requestFullscreen();
});

function updateTimerVisual(sec){
  ui.timer.classList.toggle("is-warn", sec >= 31 && sec <= 60);
  ui.timer.classList.toggle("is-danger", sec >= 0 && sec <= 30);
}

/* =========================
   CSV PARSER (robuste)
   ========================= */

function parseCSV(text){
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for(let i = 0; i < text.length; i++){
    const c = text[i];
    const next = text[i + 1];

    if(inQuotes){
      if(c === '"' && next === '"'){
        field += '"'; i++;
      } else if(c === '"'){
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if(c === '"'){ inQuotes = true; continue; }

    if(c === ","){
      row.push(field); field = "";
      continue;
    }

    if(c === "\r" && next === "\n"){
      row.push(field); field = "";
      rows.push(row); row = [];
      i++;
      continue;
    }
    if(c === "\n" || c === "\r"){
      row.push(field); field = "";
      rows.push(row); row = [];
      continue;
    }

    field += c;
  }

  row.push(field);
  rows.push(row);

  return rows
    .map(r => r.map(x => (x ?? "").trim()))
    .filter(r => r.some(x => x.length > 0));
}

/* =========================
   ÉTIQUETTES LIBRES (drag “papier”)
   ========================= */

let drag = null;

function makeChip(text){
  const el = document.createElement("div");
  el.className = "chip";
  el.textContent = text;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");

  el.addEventListener("pointerdown", (e) => startDrag(e, el));
  return el;
}

function startDrag(e, el){
  if(state.stage !== "running") return;
  e.preventDefault();

  el.setPointerCapture(e.pointerId);
  el.classList.add("is-selected");
  el.style.zIndex = String(++state.zTop);

  const deskRect = ui.desk.getBoundingClientRect();
  const chipRect = el.getBoundingClientRect();

  const currentLeft = parseFloat(el.style.left || "0");
  const currentTop  = parseFloat(el.style.top  || "0");

  drag = {
    pointerId: e.pointerId,
    el,
    deskRect,
    startX: e.clientX,
    startY: e.clientY,
    startLeft: currentLeft,
    startTop: currentTop,
    // offset interne pour garder “le doigt” sur la meme zone
    grabOffsetX: e.clientX - chipRect.left,
    grabOffsetY: e.clientY - chipRect.top,
  };

  window.addEventListener("pointermove", onDragMove, { passive: false });
  window.addEventListener("pointerup", onDragEnd, { passive: false, once: true });
}

function onDragMove(e){
  if(!drag) return;
  e.preventDefault();

  const el = drag.el;
  const deskRect = drag.deskRect;

  // position désirée dans le repère du desk
  let x = (e.clientX - deskRect.left) - drag.grabOffsetX;
  let y = (e.clientY - deskRect.top)  - drag.grabOffsetY;

  // garder dans le cadre (confort)
  const w = el.offsetWidth;
  const h = el.offsetHeight;

  x = clamp(x, 0, Math.max(0, deskRect.width - w));
  y = clamp(y, 0, Math.max(0, deskRect.height - h));

  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
}

function onDragEnd(){
  if(!drag) return;

  window.removeEventListener("pointermove", onDragMove);

  drag.el.classList.remove("is-selected");
  drag = null;
}

/* =========================
   TIMER + SCÉNARIO
   ========================= */

function stopTimer(){
  if(state.timerId){
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function startTimer(seconds){
  stopTimer();
  state.remainingSec = seconds;
  ui.timer.textContent = formatTime(state.remainingSec);
  updateTimerVisual(state.remainingSec);
  
  state.timerId = setInterval(() => {
    state.remainingSec -= 1;
    if(state.remainingSec <= 0){
      state.remainingSec = 0;
      ui.timer.textContent = "00:00";
      updateTimerVisual(0);
      stopTimer();
      onTimeUp();
      return;
    }
    ui.timer.textContent = formatTime(state.remainingSec);
    updateTimerVisual(state.remainingSec);
  }, 1000);
}

function onTimeUp(){
  // wipe brutal
  clearDesk();

  const isLast = state.idx >= state.currentList.length - 1;

  showStageOverlay(true);
  state.stage = isLast ? "done" : "stage";

  if(isLast){
    ui.btnNext.classList.add("hidden");
    ui.doneLabel.classList.remove("hidden");
  } else {
    ui.doneLabel.classList.add("hidden");
    ui.btnNext.classList.remove("hidden");
    ui.btnNext.textContent = "Phrase suivante";
  }
}

function placeChipsTopLeft(tokens){
  const deskRect = ui.desk.getBoundingClientRect();
  const placedRects = [];

  for(const text of tokens){
    const el = makeChip(text);
    el.style.left = "0px";
    el.style.top  = "0px";
    el.style.visibility = "hidden"; // temporaire
    ui.desk.appendChild(el);

    const w = el.offsetWidth;
    const h = el.offsetHeight;

    let placed = false;
    let attempts = 0;
    const maxAttempts = 120;

    while(!placed && attempts < maxAttempts){
      attempts++;

      const x = Math.random() * (deskRect.width - w);
      const y = Math.random() * (deskRect.height - h);

      const newRect = { left:x, top:y, right:x+w, bottom:y+h };

      const collision = placedRects.some(r =>
        !(newRect.right < r.left ||
          newRect.left  > r.right ||
          newRect.bottom < r.top ||
          newRect.top > r.bottom)
      );

      if(!collision){
        el.style.left = `${x}px`;
        el.style.top  = `${y}px`;
        el.style.visibility = "visible";
        placedRects.push(newRect);
        el.style.zIndex = String(++state.zTop);
        placed = true;
      }
    }

    // si jamais trop dense → on force placement
    if(!placed){
      el.style.left = "10px";
      el.style.top  = "10px";
      el.style.visibility = "visible";
      el.style.zIndex = String(++state.zTop);
    }
  }
}

function loadPhraseAt(index){
  clearDesk();

  state.idx = index;
  const item = state.currentList[state.idx];
  const minutes = Number(item.minutes) > 0 ? Number(item.minutes) : DEFAULT_MINUTES;

  const tokens = item.tokens.slice();
  shuffleInPlace(tokens); // TOUJOURS mélangé

  placeChipsTopLeft(tokens);

  setProgressText();
  startTimer(minutes * 60);
  state.stage = "running";
}

ui.btnNext.addEventListener("click", () => {
  if(state.stage !== "stage") return;
  showStageOverlay(false);
  loadPhraseAt(state.idx + 1);
});

/* =========================
   CHARGEMENT DONNÉES (Google Sheet CSV)
   ========================= */

async function loadSheet(){
  if(!SHEET_CSV_URL){
    ui.progress.textContent = "—";
    return;
  }

  const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  if(!res.ok){
    throw new Error(`Fetch failed: ${res.status}`);
  }

  const text = await res.text();
  const rows = parseCSV(text);
  if(rows.length < 2) return;

  const header = rows[0].map(h => h.toLowerCase());
  const hasHeader = header.includes("eleve") && header.includes("phrase");

  let start = 0;
  let colEleve = 0, colPhrase = 1, colMinutes = 2;

  if(hasHeader){
    start = 1;
    colEleve = header.indexOf("eleve");
    colPhrase = header.indexOf("phrase");
    colMinutes = header.indexOf("minutes");
    if(colMinutes < 0) colMinutes = header.indexOf("minute");
    if(colMinutes < 0) colMinutes = header.indexOf("temps");
    if(colMinutes < 0) colMinutes = 2; // fallback
  }

  const map = new Map();

  for(let i = start; i < rows.length; i++){
    const r = rows[i];
    const eleve = (r[colEleve] ?? "").trim();
    const phraseCell = (r[colPhrase] ?? "").trim();
    const minutes = (r[colMinutes] ?? "").trim();

    if(!eleve || !phraseCell) continue;

    const tokens = phraseCell
      .split(TOKEN_SEPARATOR)
      .map(s => s.trim())
      .filter(Boolean);

    if(tokens.length === 0) continue;

    if(!map.has(eleve)) map.set(eleve, []);
    map.get(eleve).push({ tokens, minutes });
  }

  state.dataByStudent = map;
  buildPickUI();
}

function buildPickUI(){
  ui.pickGrid.innerHTML = "";

  const students = Array.from(state.dataByStudent.keys())
    .sort((a,b) => a.localeCompare(b, "fr"));

  for(const name of students){
    const btn = document.createElement("button");
    btn.className = "pickbtn";
    btn.textContent = name;
    btn.addEventListener("click", () => startForStudent(name));
    ui.pickGrid.appendChild(btn);
  }

  showPickOverlay(true);
}

function startForStudent(name){
  const list = state.dataByStudent.get(name) || [];
  if(list.length === 0) return;

  state.currentStudent = name;
  state.currentList = list;
  state.idx = 0;

  showPickOverlay(false);
  showStageOverlay(false);

  requestFullscreen();
  setProgressText();
  loadPhraseAt(0);
}

/* =========================
   INIT
   ========================= */

window.addEventListener("load", () => {
  ui.timer.textContent = formatTime(DEFAULT_MINUTES * 60);
  ui.progress.textContent = "—";
  showStageOverlay(false);
  showPickOverlay(true);

  loadSheet().catch((err) => console.error(err));

  updateFullscreenButton();
  document.addEventListener("fullscreenchange", updateFullscreenButton);

  // ESC (PC) : sort du plein écran si possible
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  });
});