/* Simple TTRPG Builder
   - JSON-driven content
   - XP system + skills + traits
   - Equipment requirements
   - Spell builder with vector chains + area forms + validation
   - Print-friendly sheet layout
*/

const STORAGE_KEY = "simple_ttrpg_char_v3";

// Resolve URLs relative to app.js (fixes GitHub Pages subpath issues)
const BASE_URL = new URL(".", import.meta.url);

let DB = {
  species: null,
  traits: null,
  equipment: null,
  vectors: null,
  effects: null,
  skills: null,
  rules: null,
};

function el(id){ return document.getElementById(id); }
function clampInt(n, fallback=0){
  const x = Number.parseInt(n, 10);
  return Number.isFinite(x) ? x : fallback;
}
function uid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }

function defaultState(){
  return {
    meta: {
      name: "",
      concept: "",
      xpBudget: 500,
      speciesId: "human",
      chars: { mgt: 1, agi: 1, wit: 1, tgh: 1, mtl: 1 }
    },
    notes: "",
    xpLog: [],

    skills: {},      // { skillName: value }
    traits: [],      // [traitId]

    equipment: [],   // [{id, type:"weapon"|"armor", equipped:true, data:{...}}]

    spells: [],      // [{...}]
    spellDraft: { vectorSteps: [] } // for building spells
  };
}

let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultState();
    // Ensure new keys exist
    if (!parsed.spellDraft) parsed.spellDraft = { vectorSteps: [] };
    if (!Array.isArray(parsed.spellDraft.vectorSteps)) parsed.spellDraft.vectorSteps = [];
    return parsed;
  }catch{
    return defaultState();
  }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadJSON(relPath){
  const url = new URL(relPath, BASE_URL);
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok){
    throw new Error(`Fetch failed ${res.status} for ${url.href}`);
  }
  return await res.json();
}

async function loadDatabases(){
  DB.species   = await loadJSON("data/species.json");
  DB.traits    = await loadJSON("data/traits.json");
  DB.equipment = await loadJSON("data/equipment.json");
  DB.vectors   = await loadJSON("data/spell_vectors.json");
  DB.effects   = await loadJSON("data/spell_effects.json");
  DB.skills    = await loadJSON("data/skills.json");
  DB.rules     = await loadJSON("data/rules.json");
}

/* ---------- XP ---------- */

function xpSpent(){
  return (state.xpLog || []).reduce((a,x)=>a+clampInt(x.xp,0),0);
}
function xpRemaining(){
  return clampInt(state.meta.xpBudget,0) - xpSpent();
}
function addXpEntry(entry){
  state.xpLog.push({ id: uid(), ...entry });
}

/* ---------- Characteristics & Derived ---------- */

function costToRaiseCharacteristic(toValue){
  const table = DB.rules.characteristic_raise_costs;
  return table ? clampInt(table[String(toValue)], null) : null;
}

function computeDerived(){
  const c = state.meta.chars;
  const mgt = clampInt(c.mgt, 1);
  const agi = clampInt(c.agi, 1);
  const wit = clampInt(c.wit, 1);
  const tgh = clampInt(c.tgh, 1);

  const species = (DB.species.species || []).find(s => s.id === state.meta.speciesId);
  const baseMove = clampInt(species?.base?.move, 0);

  // YOU: HP = Toughness + floor(Might/2)
  // YOU: AP = 3 + floor(Agility/3)
  // YOU: RAP = floor(Wits/3)
  // YOU: Move = base species move + floor(Agility/3)
  const hp  = tgh + Math.floor(mgt / 2);
  const ap  = 3 + Math.floor(agi / 3);
  const rap = Math.floor(wit / 3);
  const movePerAP = baseMove + Math.floor(agi / 3);

  return { hp, ap, rap, movePerAP };
}

function currentCharFromInputs(){
  return {
    mgt: clampInt(el("mgt").value, 1),
    agi: clampInt(el("agi").value, 1),
    wit: clampInt(el("wit").value, 1),
    tgh: clampInt(el("tgh").value, 1),
    mtl: clampInt(el("mtl").value, 1),
  };
}

function computeCharUpgradeCost(oldC, newC){
  let total = 0;
  const lines = [];

  for(const key of ["mgt","agi","wit","tgh","mtl"]){
    const from = clampInt(oldC[key], 1);
    const to = clampInt(newC[key], 1);
    if(to < 1) return { ok:false, total:0, lines:[`Invalid ${key}.`] };
    if(to < from){
      return { ok:false, total:0, lines:[`Cannot decrease characteristics (${key.toUpperCase()}).`] };
    }
    if(to === from) continue;

    for(let v = from+1; v <= to; v++){
      const c = costToRaiseCharacteristic(v);
      if(c == null) return { ok:false, total:0, lines:[`No XP cost defined for raising to ${v}.`] };
      total += c;
      lines.push(`${key.toUpperCase()} +${c} XP (raise to ${v})`);
    }
  }

  return { ok:true, total, lines };
}

function applyCharacteristicChanges(){
  const oldC = state.meta.chars;
  const newC = currentCharFromInputs();
  const cost = computeCharUpgradeCost(oldC, newC);
  if(!cost.ok){
    alert(cost.lines.join("\n"));
    return;
  }
  if(cost.total > xpRemaining()){
    alert(`Not enough XP. Need ${cost.total}, have ${xpRemaining()}.`);
    return;
  }
  if(cost.total === 0){
    return alert("No changes to apply.");
  }

  addXpEntry({ kind:"characteristics", name:"Raise characteristics", xp: cost.total });
  state.meta.chars = newC;

  saveState();
  renderAll();
}

/* ---------- Skills ---------- */

function ensureSkillsInitialized(){
  const basics = DB.skills.basic || [];
  for(const s of basics){
    if(state.skills[s] == null) state.skills[s] = 20;
  }
}

function buyNewSkill(){
  const name = el("newSkillName").value.trim();
  if(!name) return alert("Enter a skill name.");
  if(state.skills[name] != null) return alert("You already have that skill.");

  const cost = 20;
  if(cost > xpRemaining()) return alert(`Not enough XP. Need ${cost}, have ${xpRemaining()}.`);

  state.skills[name] = 20;
  addXpEntry({ kind:"skill_buy", name:`Buy skill: ${name}`, xp: cost });

  el("newSkillName").value = "";
  saveState();
  renderAll();
}

function rebuildSkillSelect(){
  const sel = el("skillSelect");
  const prev = sel.value;

  sel.innerHTML = "";
  const names = Object.keys(state.skills || {}).sort((a,b)=>a.localeCompare(b));
  for (const name of names){
    const o = document.createElement("option");
    o.value = name;
    o.textContent = `${name} (${state.skills[name]})`;
    sel.appendChild(o);
  }

  // restore previous selection if possible
  if (prev && state.skills[prev] != null) sel.value = prev;
  // else keep first if exists
}

function increaseSkill(){
  const name = el("skillSelect").value;
  if(!name) return;

  const n = Math.max(1, clampInt(el("skillIncBy").value, 1));
  const current = clampInt(state.skills[name], 0);

  // Total cost is sum(current..current+n-1)
  let totalCost = 0;
  for(let i=0;i<n;i++){
    totalCost += (current + i);
  }
  if(totalCost > xpRemaining()){
    return alert(`Not enough XP. Need ${totalCost}, have ${xpRemaining()}.`);
  }

  state.skills[name] = current + n;
  addXpEntry({ kind:"skill_inc", name:`${name} +${n} (${current}→${current+n})`, xp: totalCost });

  saveState();
  renderAll();

  // keep selection stable
  el("skillSelect").value = name;
}

function decreaseSkill(){
  const name = el("skillSelect").value;
  if(!name) return;

  const basics = new Set(DB.skills.basic || []);
  const current = clampInt(state.skills[name], 0);

  if(basics.has(name) && current <= 20){
    return alert("Basic skills can't go below 20.");
  }

  // If specialized skill at 20: allow removing it by refunding its buy cost (best-effort)
  if(!basics.has(name) && current <= 20){
    // remove last buy entry if present, otherwise just delete without refund
    const idx = [...state.xpLog].reverse().findIndex(x => x.kind==="skill_buy" && x.name===`Buy skill: ${name}`);
    if(idx !== -1){
      const realIndex = state.xpLog.length - 1 - idx;
      state.xpLog.splice(realIndex, 1);
    }
    delete state.skills[name];
    saveState();
    renderAll();
    return;
  }

  // Refund best-effort: refund (current-1)
  const refund = current - 1;
  state.skills[name] = current - 1;
  addXpEntry({ kind:"refund", name:`Refund ${name} ${current}→${current-1}`, xp: -refund });

  saveState();
  renderAll();
  el("skillSelect").value = name;
}

/* ---------- Traits ---------- */

function rebuildTraits(){
  const sel = el("traitSelect");
  sel.innerHTML = "";
  for(const t of (DB.traits.traits || [])){
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = `${t.name} (${t.xp} XP)`;
    sel.appendChild(o);
  }
}

function ownedTraits(){
  const ids = new Set(state.traits || []);
  return (DB.traits.traits || []).filter(t => ids.has(t.id));
}

function addTrait(){
  const id = el("traitSelect").value;
  if(!id) return;
  if(state.traits.includes(id)) return alert("Trait already added.");

  const t = (DB.traits.traits || []).find(x => x.id === id);
  if(!t) return alert("Trait not found in JSON.");

  const cost = clampInt(t.xp, 0);
  if(cost > xpRemaining()) return alert(`Not enough XP. Need ${cost}, have ${xpRemaining()}.`);

  state.traits.push(id);
  addXpEntry({ kind:"trait", name:`Trait: ${t.name}`, xp: cost });

  saveState();
  renderAll();
}

function removeTrait(id){
  const t = (DB.traits.traits || []).find(x => x.id === id);
  state.traits = state.traits.filter(x => x !== id);

  // refund as negative XP (simple accounting)
  if(t){
    addXpEntry({ kind:"refund", name:`Refund trait: ${t.name}`, xp: -clampInt(t.xp,0) });
  }
  saveState();
  renderAll();
}

/* ---------- Species ---------- */

function rebuildSpecies(){
  const sel = el("species");
  sel.innerHTML = "";
  for(const s of (DB.species.species || [])){
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  }
  sel.value = state.meta.speciesId || "human";
  sel.addEventListener("change", () => {
    state.meta.speciesId = sel.value;
    saveState(); renderAll();
  });
}

/* ---------- Equipment ---------- */

function requiredMightForArmor(category){
  return clampInt(DB.equipment.armorMightReq?.[category], 0);
}
function requiredMightForWeapon(weapon){
  if(weapon.weight === "heavy") return clampInt(DB.equipment.heavyWeaponMightReq, 4);
  return 0;
}

function rebuildEquipment(){
  const wSel = el("weaponSelect");
  wSel.innerHTML = "";
  for(const w of (DB.equipment.equipment.weapons || [])){
    const o = document.createElement("option");
    o.value = w.id;
    o.textContent = `${w.name} (${w.apCost} AP, ${w.damage})`;
    wSel.appendChild(o);
  }

  const aSel = el("armorSelect");
  aSel.innerHTML = "";
  for(const a of (DB.equipment.equipment.armor || [])){
    const req = requiredMightForArmor(a.category);
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = `${a.name} (DR ${a.dr}, req MGT ${req})`;
    aSel.appendChild(o);
  }
}

function addWeapon(){
  const id = el("weaponSelect").value;
  const w = (DB.equipment.equipment.weapons || []).find(x => x.id === id);
  if(!w) return alert("Weapon not found in JSON.");

  const mgt = clampInt(state.meta.chars.mgt, 1);
  const req = requiredMightForWeapon(w);
  if(mgt < req) return alert(`Requires Might ${req}+ for heavy weapons.`);

  state.equipment.push({ id: uid(), type:"weapon", equipped:true, data:w });
  saveState();
  renderAll();
}

function addArmor(){
  const id = el("armorSelect").value;
  const a = (DB.equipment.equipment.armor || []).find(x => x.id === id);
  if(!a) return alert("Armor not found in JSON.");

  const mgt = clampInt(state.meta.chars.mgt, 1);
  const req = requiredMightForArmor(a.category);
  if(mgt < req) return alert(`Requires Might ${req}+ for that armor.`);

  // only one armor equipped at a time
  for(const it of state.equipment){
    if(it.type === "armor") it.equipped = false;
  }
  state.equipment.push({ id: uid(), type:"armor", equipped:true, data:a });
  saveState();
  renderAll();
}

function toggleEquip(itemId){
  const it = state.equipment.find(x => x.id === itemId);
  if(!it) return;

  if(it.type === "armor" && !it.equipped){
    for(const x of state.equipment){
      if(x.type === "armor") x.equipped = false;
    }
  }
  it.equipped = !it.equipped;
  saveState();
  renderAll();
}

function removeEquip(itemId){
  state.equipment = state.equipment.filter(x => x.id !== itemId);
  saveState();
  renderAll();
}

function equippedWeaponList(){
  return (state.equipment || []).filter(x => x.type==="weapon" && x.equipped).map(x=>x.data);
}

/* ---------- Spell Builder (vector chain) ---------- */

function rebuildSpellEffects(){
  const eSel = el("spellEffects");
  eSel.innerHTML = "";
  for(const e of (DB.effects.effects || [])){
    const o = document.createElement("option");
    o.value = e.id;
    o.textContent = e.name;
    eSel.appendChild(o);
  }
}

function initSpellVectorUI() {
  const vSel = el("vectorAddSelect");
  vSel.innerHTML = "";
  for (const v of (DB.vectors.vectors || [])) {
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = v.name;
    vSel.appendChild(o);
  }

  const aSel = el("areaFormSelect");
  aSel.innerHTML = "";
  for (const f of (DB.vectors.areaForms || [])) {
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = f.name;
    aSel.appendChild(o);
  }

  function refreshAreaControls() {
    const chosenId = vSel.value;
    const vec = (DB.vectors.vectors || []).find(x => x.id === chosenId);
    const isArea = vec?.type === "area";
    el("areaFormSelect").disabled = !isArea;
    el("areaLevelInput").disabled = !isArea;
  }
  vSel.addEventListener("change", refreshAreaControls);
  refreshAreaControls();

  if (!state.spellDraft) state.spellDraft = { vectorSteps: [] };
  if (!Array.isArray(state.spellDraft.vectorSteps)) state.spellDraft.vectorSteps = [];
}

function getDraftSteps() {
  if (!state.spellDraft) state.spellDraft = { vectorSteps: [] };
  if (!Array.isArray(state.spellDraft.vectorSteps)) state.spellDraft.vectorSteps = [];
  return state.spellDraft.vectorSteps;
}

function validateVectorChain(steps) {
  // Disallow "area then totem"
  let areaSeen = false;
  for (const s of steps) {
    if (s.type === "area") areaSeen = true;
    if (areaSeen && s.type === "totem") {
      return { ok: false, msg: "Invalid chain: Area + Totem is not allowed. Use Totem + Area instead." };
    }
  }
  return { ok: true };
}

function addVectorStepFromUI() {
  const steps = getDraftSteps();

  const vecId = el("vectorAddSelect").value;
  const vec = (DB.vectors.vectors || []).find(v => v.id === vecId);
  if (!vec) return alert("Vector not found.");

  const step = { id: uid(), vectorId: vec.id, type: vec.type, name: vec.name };

  if (vec.type === "area") {
    step.areaFormId = el("areaFormSelect").value;
    step.areaFormName = (DB.vectors.areaForms || []).find(f => f.id === step.areaFormId)?.name || step.areaFormId;
    step.areaLevel = clampInt(el("areaLevelInput").value, 0);
    if (step.areaLevel <= 0) return alert("Area Level must be > 0.");
  }

  steps.push(step);

  const check = validateVectorChain(steps);
  if (!check.ok) {
    steps.pop();
    return alert(check.msg);
  }

  saveState();
  renderVectorChain();
  renderAll();
}

function removeVectorStep(stepId) {
  const steps = getDraftSteps();
  state.spellDraft.vectorSteps = steps.filter(s => s.id !== stepId);
  saveState();
  renderVectorChain();
}

function renderVectorChain() {
  const list = el("vectorChainList");
  list.innerHTML = "";

  const steps = getDraftSteps();
  if (!steps.length) {
    el("vectorChainHint").style.display = "block";
    return;
  }
  el("vectorChainHint").style.display = "none";

  for (const s of steps) {
    const row = document.createElement("div");
    row.className = "item";

    const left = document.createElement("div");
    left.style.flex = "1";
    const extra = s.type === "area" ? ` • ${s.areaFormName} • L${s.areaLevel}` : "";
    left.innerHTML = `<div class="title">${s.name}${extra}</div><div class="sub">Step</div>`;

    const right = document.createElement("div");
    right.className = "right";

    const rm = document.createElement("button");
    rm.className = "small danger";
    rm.textContent = "Remove";
    rm.addEventListener("click", () => removeVectorStep(s.id));

    right.appendChild(rm);
    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  }
}

function computeSpellSL(vectorSteps, damageLevel, totemLevel) {
  let sl = 0;
  for (const s of vectorSteps) {
    if (s.type === "dart") sl += 1;
    if (s.type === "totem") sl += clampInt(totemLevel, 0) * 3;
    if (s.type === "area") sl += clampInt(s.areaLevel, 0) * 2;
  }
  sl += clampInt(damageLevel, 0) * 2;
  return sl;
}

function clearSpellForm(){
  state.spellDraft.vectorSteps = [];
  el("spellName").value = "";
  el("spellDamageLevel").value = 0;
  el("spellTotemLevel").value = 0;
  el("spellShortNote").value = "";
  el("spellText").value = "";
  Array.from(el("spellEffects").options).forEach(o => o.selected = false);

  saveState();
  renderVectorChain();
}

function addSpell(){
  const name = el("spellName").value.trim();
  if (!name) return alert("Spell name required.");

  const steps = getDraftSteps();
  if (!steps.length) return alert("Add at least one vector step.");

  const check = validateVectorChain(steps);
  if (!check.ok) return alert(check.msg);

  const effectIds = Array.from(el("spellEffects").selectedOptions).map(o => o.value);
  if (!effectIds.length) return alert("Select at least one effect.");

  const effects = effectIds
    .map(id => (DB.effects.effects || []).find(e => e.id === id))
    .filter(Boolean)
    .map(e => ({ id: e.id, name: e.name }));

  const damageLevel = clampInt(el("spellDamageLevel").value, 0);
  const totemLevel = clampInt(el("spellTotemLevel").value, 0);

  if (steps.some(s => s.type === "totem") && totemLevel <= 0) {
    return alert("Totem Level must be > 0 when using Totem vector.");
  }

  const slCost = computeSpellSL(steps, damageLevel, totemLevel);

  state.spells.push({
    id: uid(),
    name,
    vectorSteps: structuredClone(steps),
    effects,
    damageLevel,
    totemLevel,
    slCost,
    shortNote: el("spellShortNote").value.trim(),
    text: el("spellText").value.trim()
  });

  clearSpellForm();
  saveState();
  renderAll();
}

function removeSpell(spellId){
  state.spells = state.spells.filter(s => s.id !== spellId);
  saveState();
  renderAll();
}

/* ---------- Actions & Reactions ---------- */

function unarmedDamage(){
  const mgt = clampInt(state.meta.chars.mgt, 1);
  return Math.max(1, Math.floor(mgt / 3));
}

function buildActionsAndReactions(){
  const d = computeDerived();
  const actions = [];
  const reactions = [];

  actions.push({ name:"Move", cost:"1 AP", text:`Move up to ${d.movePerAP} hexes.` });
  actions.push({ name:"Attack (Unarmed)", cost:"1 AP", text:`Damage: ${unarmedDamage()} (floor(Might/3), min 1). Skill: Melee.` });

  for(const w of equippedWeaponList()){
    actions.push({
      name:`Attack (${w.name})`,
      cost:`${w.apCost} AP`,
      text:`Damage: ${w.damage}. Skill: ${w.skill || (w.kind==="ranged" ? "Ranged" : "Melee")}.`
    });
  }

  // baseline reaction
  reactions.push({ name:"Dodge", cost:"1 RAP", text:`Roll Dodge. Success: DR = Success Level. Crit success: 0 damage.` });

  // trait-granted actions/reactions if present in JSON
  for(const t of ownedTraits()){
    const grants = t.grants || {};
    for(const a of (grants.actions || [])){
      actions.push({ name: a.name, cost: `${a.apCost} AP`, text: a.text || `Granted by ${t.name}.` });
    }
    for(const r of (grants.reactions || [])){
      reactions.push({ name: r.name, cost: `${r.rapCost} RAP`, text: r.text || `Granted by ${t.name}.` });
    }
  }

  return { derived:d, actions, reactions };
}

/* ---------- Rendering ---------- */

function renderXP(){
  const budget = clampInt(state.meta.xpBudget,0);
  const spent = xpSpent();
  const rem = budget - spent;

  el("xpBudgetLbl").textContent = String(budget);
  el("xpSpentLbl").textContent = String(spent);
  el("xpRemainingLbl").textContent = String(rem);
}

function renderMetaInputs(){
  el("name").value = state.meta.name || "";
  el("concept").value = state.meta.concept || "";
  el("xpBudget").value = String(clampInt(state.meta.xpBudget, 0));

  const c = state.meta.chars;
  el("mgt").value = String(clampInt(c.mgt,1));
  el("agi").value = String(clampInt(c.agi,1));
  el("wit").value = String(clampInt(c.wit,1));
  el("tgh").value = String(clampInt(c.tgh,1));
  el("mtl").value = String(clampInt(c.mtl,1));

  el("notes").value = state.notes || "";
}

function renderCharCostHint(){
  const oldC = state.meta.chars;
  const newC = currentCharFromInputs();
  const cost = computeCharUpgradeCost(oldC, newC);
  if(!cost.ok){
    el("charCostHint").textContent = cost.lines.join(" ");
  }else{
    el("charCostHint").textContent = cost.total === 0 ? "No changes." : `Cost if applied: ${cost.total} XP`;
  }
}

function renderSkills(){
  const list = el("skillsList");
  list.innerHTML = "";

  const names = Object.keys(state.skills || {}).sort((a,b)=>a.localeCompare(b));
  for(const name of names){
    const v = state.skills[name];
    const row = document.createElement("div");
    row.className = "item";
    const left = document.createElement("div");
    left.style.flex = "1";
    left.innerHTML = `<div class="title">${name}</div><div class="sub">Value: ${v}</div>`;
    row.appendChild(left);
    list.appendChild(row);
  }

  rebuildSkillSelect();

  const chosen = el("skillSelect").value;
  if(chosen){
    const current = clampInt(state.skills[chosen], 0);
    el("skillCostHint").textContent = `Increase ${chosen}: +1 costs ${current} XP. Increase by N costs sum of next N steps.`;
  }else{
    el("skillCostHint").textContent = "No skills found.";
  }
}

function renderTraits(){
  const list = el("traitsList");
  list.innerHTML = "";

  const owned = ownedTraits();
  if(owned.length === 0){
    el("emptyTraits").style.display = "block";
    return;
  }
  el("emptyTraits").style.display = "none";

  for(const t of owned){
    const row = document.createElement("div");
    row.className = "item";

    const left = document.createElement("div");
    left.style.flex = "1";
    left.innerHTML = `<div class="title">${t.name}</div><div class="sub">${t.desc || ""}</div>`;

    const right = document.createElement("div");
    right.className = "right";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `${t.xp} XP`;
    const rm = document.createElement("button");
    rm.className = "small danger";
    rm.textContent = "Remove";
    rm.addEventListener("click", ()=>removeTrait(t.id));

    right.appendChild(badge);
    right.appendChild(rm);

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  }
}

function renderEquipment(){
  const list = el("equipList");
  list.innerHTML = "";

  if((state.equipment || []).length === 0){
    el("emptyEquip").style.display = "block";
    return;
  }
  el("emptyEquip").style.display = "none";

  for(const it of state.equipment){
    const row = document.createElement("div");
    row.className = "item";

    const left = document.createElement("div");
    left.style.flex = "1";
    const tag = it.type === "armor"
      ? `Armor • DR ${it.data.dr}`
      : `Weapon • ${it.data.apCost} AP • ${it.data.damage}`;
    left.innerHTML = `<div class="title">${it.data.name}</div><div class="sub">${tag}</div>`;

    const right = document.createElement("div");
    right.className = "right";

    const eq = document.createElement("button");
    eq.className = "small";
    eq.textContent = it.equipped ? "Equipped" : "Carry";
    eq.addEventListener("click", ()=>toggleEquip(it.id));

    const rm = document.createElement("button");
    rm.className = "small danger";
    rm.textContent = "Remove";
    rm.addEventListener("click", ()=>removeEquip(it.id));

    right.appendChild(eq);
    right.appendChild(rm);

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  }
}

function renderSpells(){
  const list = el("spellsList");
  list.innerHTML = "";

  if((state.spells || []).length === 0){
    el("emptySpells").style.display = "block";
    return;
  }
  el("emptySpells").style.display = "none";

  for(const sp of [...state.spells].reverse()){
    const row = document.createElement("div");
    row.className = "item";

    const left = document.createElement("div");
    left.style.flex = "1";

    const chain = (sp.vectorSteps || []).map(s => {
      if (s.type === "area") return `${s.areaFormName} L${s.areaLevel}`;
      return s.name;
    }).join(" + ");

    const fx = (sp.effects || []).map(e=>e.name).join(", ");
    left.innerHTML = `<div class="title">${sp.name}</div><div class="sub">${chain} • ${fx} • Cost: ${sp.slCost} SL</div>`;

    const right = document.createElement("div");
    right.className = "right";
    const rm = document.createElement("button");
    rm.className = "small danger";
    rm.textContent = "Remove";
    rm.addEventListener("click", ()=>removeSpell(sp.id));
    right.appendChild(rm);

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  }
}

function renderSheet(){
  const d = computeDerived();
  const species = (DB.species.species || []).find(s => s.id === state.meta.speciesId);

  el("sheetName").textContent = state.meta.name?.trim() ? state.meta.name : "Unnamed";
  el("sheetMeta").textContent = `${state.meta.concept || "—"} • ${species?.name || "—"} • XP: ${xpSpent()}/${clampInt(state.meta.xpBudget,0)} (rem ${xpRemaining()})`;

  el("sheetHP").textContent = String(d.hp);
  el("sheetAP").textContent = String(d.ap);
  el("sheetRAP").textContent = String(d.rap);
  el("sheetMove").textContent = String(d.movePerAP);

  const c = state.meta.chars;
  el("sheetChars").textContent =
`Might: ${c.mgt}
Agility: ${c.agi}
Wits: ${c.wit}
Toughness: ${c.tgh}
Mental: ${c.mtl}`;

  const skillLines = Object.keys(state.skills || {}).sort((a,b)=>a.localeCompare(b))
    .map(k => `${k}: ${state.skills[k]}`)
    .join("\n");
  el("sheetSkills").textContent = skillLines || "—";

  const traitLines = ownedTraits().map(t => `- ${t.name}`).join("\n");
  el("sheetTraits").textContent = traitLines || "—";

  const eqLines = (state.equipment || []).map(it => {
    const mark = it.equipped ? "■" : "□";
    if(it.type === "armor") return `${mark} ${it.data.name} (Armor DR ${it.data.dr})`;
    return `${mark} ${it.data.name} (${it.data.apCost} AP, ${it.data.damage})`;
  }).join("\n");
  el("sheetEquip").textContent = eqLines || "—";

  const ar = buildActionsAndReactions();
  el("sheetAPTotal").textContent = String(ar.derived.ap);
  el("sheetRAPTotal").textContent = String(ar.derived.rap);

  el("sheetActions").textContent = ar.actions.map(a => `• ${a.name} — ${a.cost}\n  ${a.text}`).join("\n\n");
  el("sheetReactions").textContent = ar.reactions.map(r => `• ${r.name} — ${r.cost}\n  ${r.text}`).join("\n\n");

  if((state.spells || []).length === 0){
    el("sheetSpells").textContent = "—";
  }else{
    el("sheetSpells").textContent = state.spells.map(sp => {
      const chain = (sp.vectorSteps || []).map(s => {
        if (s.type === "area") return `${s.areaFormName} L${s.areaLevel}`;
        return s.name;
      }).join(" + ");
      const fx = (sp.effects||[]).map(e=>e.name).join(", ");
      const extra = [
        sp.damageLevel ? `Damage L${sp.damageLevel}` : null,
        sp.vectorSteps?.some(v => v.type==="totem") ? `Totem L${sp.totemLevel}` : null,
        sp.shortNote ? sp.shortNote : null
      ].filter(Boolean).join(" • ");
      const text = sp.text ? `\n  ${sp.text}` : "";
      return `• ${sp.name} (${chain}) [${sp.slCost} SL]\n  Effects: ${fx}${extra ? `\n  ${extra}` : ""}${text}`;
    }).join("\n\n");
  }

  el("sheetNotes").textContent = state.notes?.trim() ? state.notes : "—";
}

function renderAll(){
  renderXP();
  renderMetaInputs();
  renderCharCostHint();
  renderSkills();
  renderTraits();
  renderEquipment();
  renderVectorChain();
  renderSpells();
  renderSheet();
}

/* ---------- UI Bindings ---------- */

function bindUI(){
  el("name").addEventListener("input", (e)=>{ state.meta.name = e.target.value; saveState(); renderAll(); });
  el("concept").addEventListener("input", (e)=>{ state.meta.concept = e.target.value; saveState(); renderAll(); });
  el("xpBudget").addEventListener("input", (e)=>{ state.meta.xpBudget = clampInt(e.target.value,0); saveState(); renderAll(); });

  for(const id of ["mgt","agi","wit","tgh","mtl"]){
    el(id).addEventListener("input", ()=>{ renderCharCostHint(); });
  }

  el("applyCharBtn").addEventListener("click", applyCharacteristicChanges);

  el("buySkillBtn").addEventListener("click", buyNewSkill);
  el("incSkillBtn").addEventListener("click", increaseSkill);
  el("decSkillBtn").addEventListener("click", decreaseSkill);

  el("addTraitBtn").addEventListener("click", addTrait);

  el("addWeaponBtn").addEventListener("click", addWeapon);
  el("addArmorBtn").addEventListener("click", addArmor);

  el("addVectorBtn").addEventListener("click", addVectorStepFromUI);

  el("addSpellBtn").addEventListener("click", addSpell);
  el("clearSpellBtn").addEventListener("click", clearSpellForm);

  el("notes").addEventListener("input", (e)=>{ state.notes = e.target.value; saveState(); renderAll(); });

  el("exportBtn").addEventListener("click", ()=>{
    el("jsonBox").value = JSON.stringify(state, null, 2);
  });
  el("importBtn").addEventListener("click", ()=>{
    try{
      const raw = el("jsonBox").value.trim();
      if(!raw) return alert("Paste JSON first.");
      const parsed = JSON.parse(raw);
      state = parsed;
      if (!state.spellDraft) state.spellDraft = { vectorSteps: [] };
      if (!Array.isArray(state.spellDraft.vectorSteps)) state.spellDraft.vectorSteps = [];
      saveState();
      renderAll();
    }catch(err){
      alert("Import failed: " + (err?.message || String(err)));
    }
  });

  el("printBtn").addEventListener("click", ()=>window.print());

  el("resetBtn").addEventListener("click", ()=>{
    if(confirm("Reset character?")){
      state = defaultState();
      ensureSkillsInitialized();
      saveState();
      renderAll();
    }
  });
}

/* ---------- Boot ---------- */

async function init(){
  try{
    await loadDatabases();
  }catch(e){
    alert(
      "Failed to load JSON data.\n" +
      "Check that your folder is named 'data' and files are inside it.\n\n" +
      String(e)
    );
    console.error(e);
    return;
  }

  ensureSkillsInitialized();

  rebuildSpecies();
  rebuildTraits();
  rebuildEquipment();
  rebuildSpellEffects();
  initSpellVectorUI();

  bindUI();
  renderAll();
}

init();
