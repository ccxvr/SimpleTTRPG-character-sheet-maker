/* Simple TTRPG Builder
   JSON-driven content + XP system + skills + derived stats + action lists
*/

const STORAGE_KEY = "simple_ttrpg_char_v2";

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
      // Characteristics
      chars: { mgt: 1, agi: 1, wit: 1, tgh: 1, mtl: 1 },
    },
    notes: "",
    // XP spend tracking
    xpLog: [], // {id, kind, name, xp}
    // Skills
    skills: {}, // {skillName: value}
    // Traits (store trait IDs)
    traits: [], // [traitId]
    // Equipment (no xp)
    equipment: [], // [{id, type:"weapon"|"armor", data:<object>, equipped:true}]
    // Spells
    spells: [], // [{...}]
  };
}

let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : defaultState();
  }catch{
    return defaultState();
  }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadJSON(path){
  const res = await fetch(path, { cache: "no-store" });
  if(!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return await res.json();
}

async function loadDatabases(){
  // IMPORTANT: use ./data/... so it works on GitHub Pages subpaths
  DB.species   = await loadJSON("./data/species.json");
  DB.traits    = await loadJSON("./data/traits.json");
  DB.equipment = await loadJSON("./data/equipment.json");
  DB.vectors   = await loadJSON("./data/spell_vectors.json");
  DB.effects   = await loadJSON("./data/spell_effects.json");
  DB.skills    = await loadJSON("./data/skills.json");
  DB.rules     = await loadJSON("./data/rules.json");
}

/* ---------- Rules helpers (from your doc) ---------- */

function costToRaiseCharacteristic(toValue){
  // Table from rules doc :contentReference[oaicite:2]{index=2}
  const table = DB.rules.characteristic_raise_costs;
  return clampInt(table[String(toValue)], null);
}

function computeDerived(){
  const c = state.meta.chars;
  const mgt = clampInt(c.mgt, 1);
  const agi = clampInt(c.agi, 1);
  const wit = clampInt(c.wit, 1);
  const tgh = clampInt(c.tgh, 1);

  const species = (DB.species.species || []).find(s => s.id === state.meta.speciesId);
  const baseMove = clampInt(species?.base?.move, 0);

  const hp  = tgh + Math.floor(mgt / 2);                     // :contentReference[oaicite:3]{index=3}
  const ap  = 3 + Math.floor(agi / 3);                       // :contentReference[oaicite:4]{index=4}
  const rap = Math.floor(wit / 3);                           // :contentReference[oaicite:5]{index=5}
  const movePerAP = baseMove + Math.floor(agi / 2);          // doc says /2 :contentReference[oaicite:6]{index=6}

  return { hp, ap, rap, movePerAP };
}

function xpSpent(){
  return (state.xpLog || []).reduce((a,x)=>a+clampInt(x.xp,0),0);
}
function xpRemaining(){
  return clampInt(state.meta.xpBudget,0) - xpSpent();
}
function addXpEntry(entry){
  state.xpLog.push({ id: uid(), ...entry });
}
function removeXpEntry(entryId){
  state.xpLog = state.xpLog.filter(x => x.id !== entryId);
}

/* ---------- Initialize skills ---------- */

function ensureSkillsInitialized(){
  const basics = DB.skills.basic || [];
  for(const s of basics){
    if(state.skills[s] == null) state.skills[s] = 20; // :contentReference[oaicite:7]{index=7}
  }
}

/* ---------- UI population ---------- */

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

function rebuildSpellsBuilder(){
  const vSel = el("spellVector");
  vSel.innerHTML = "";
  for(const v of (DB.vectors.vectors || [])){
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = v.name;
    vSel.appendChild(o);
  }

  const eSel = el("spellEffects");
  eSel.innerHTML = "";
  for(const e of (DB.effects.effects || [])){
    const o = document.createElement("option");
    o.value = e.id;
    o.textContent = e.name;
    eSel.appendChild(o);
  }
}

function rebuildSkillSelect(){
  const sel = el("skillSelect");
  sel.innerHTML = "";
  const names = Object.keys(state.skills || {}).sort((a,b)=>a.localeCompare(b));
  for(const name of names){
    const o = document.createElement("option");
    o.value = name;
    o.textContent = `${name} (${state.skills[name]})`;
    sel.appendChild(o);
  }
}

/* ---------- Equipment rules ---------- */

function requiredMightForArmor(category){
  return clampInt(DB.equipment.armorMightReq?.[category], 0);
}
function requiredMightForWeapon(weapon){
  if(weapon.weight === "heavy") return clampInt(DB.equipment.heavyWeaponMightReq, 4);
  return 0;
}

/* ---------- Buying characteristics (XP) ---------- */

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
      // allow decreases with refund? keep it simple: disallow by default
      return { ok:false, total:0, lines:[`Cannot decrease characteristics ( ${key.toUpperCase()} ).`] };
    }
    if(to === from) continue;

    for(let v = from+1; v <= to; v++){
      const c = costToRaiseCharacteristic(v);
      if(c == null) return { ok:false, total:0, lines:[`No XP cost defined for raising to ${v}.`] };
      total += c;
      lines.push(`${key.toUpperCase()} ${from}→${to}: +${c} XP (raise to ${v})`);
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

  // log one entry per characteristic changed, so you can refund later by editing state if needed
  // (simple approach: single combined entry)
  addXpEntry({
    kind: "characteristics",
    name: `Raise characteristics`,
    xp: cost.total
  });

  state.meta.chars = newC;
  saveState();
  renderAll();
}

/* ---------- Skills (XP) ---------- */

function buyNewSkill(){
  const name = el("newSkillName").value.trim();
  if(!name) return alert("Enter a skill name.");
  if(state.skills[name] != null) return alert("You already have that skill.");

  const cost = 20; // :contentReference[oaicite:8]{index=8}
  if(cost > xpRemaining()) return alert(`Not enough XP. Need ${cost}, have ${xpRemaining()}.`);

  state.skills[name] = 20;
  addXpEntry({ kind:"skill_buy", name:`Buy skill: ${name}`, xp: cost });

  el("newSkillName").value = "";
  saveState();
  renderAll();
}

function increaseSkill(){
  const sel = el("skillSelect");
  const name = sel.value;
  if(!name) return;

  const current = clampInt(state.skills[name], 0);
  const cost = current; // cost = current value :contentReference[oaicite:9]{index=9}
  if(cost > xpRemaining()) return alert(`Not enough XP. Need ${cost}, have ${xpRemaining()}.`);

  state.skills[name] = current + 1;
  addXpEntry({ kind:"skill_inc", name:`${name} ${current}→${current+1}`, xp: cost });

  saveState();
  renderAll();
}

function decreaseSkill(){
  const sel = el("skillSelect");
  const name = sel.value;
  if(!name) return;

  const current = clampInt(state.skills[name], 0);
  if(current <= 20 && (DB.skills.basic || []).includes(name)){
    return alert("Basic skills can't go below 20.");
  }
  if(current <= 20 && !(DB.skills.basic || []).includes(name)){
    // If specialized skill at 20, allow "unbuy" with refund of 20 (best-effort)
    // find last buy entry
    const idx = [...state.xpLog].reverse().findIndex(x => x.kind==="skill_buy" && x.name===`Buy skill: ${name}`);
    if(idx === -1) return alert("Cannot refund this skill (no purchase log found).");
    // remove that entry
    const realIndex = state.xpLog.length - 1 - idx;
    state.xpLog.splice(realIndex, 1);
    delete state.skills[name];
    saveState();
    renderAll();
    return;
  }

  // refund: remove the last matching increase entry for that step if possible
  // best-effort: refund current-1 XP
  const refund = current - 1;
  state.skills[name] = current - 1;
  addXpEntry({ kind:"refund", name:`Refund ${name} ${current}→${current-1}`, xp: -refund });

  saveState();
  renderAll();
}

/* ---------- Traits ---------- */

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

  // best-effort refund: add negative XP equal to trait cost
  if(t){
    addXpEntry({ kind:"refund", name:`Refund trait: ${t.name}`, xp: -clampInt(t.xp,0) });
  }
  saveState();
  renderAll();
}

function ownedTraits(){
  const ids = new Set(state.traits || []);
  return (DB.traits.traits || []).filter(t => ids.has(t.id));
}

/* ---------- Equipment ---------- */

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

  // only one armor equipped at a time: auto-unequip others
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
    // equipping armor unequips other armor
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
function equippedArmor(){
  return (state.equipment || []).find(x => x.type==="armor" && x.equipped)?.data || null;
}

/* ---------- Spells (basic builder, includes SL cost calculation from doc) ---------- */

function selectedMultiIds(selectEl){
  return Array.from(selectEl.selectedOptions).map(o => o.value);
}

function spellCostSL(vectorId, areaLevel, damageLevel, totemLevel){
  // From doc:
  // Dart cost 1 SL :contentReference[oaicite:10]{index=10}
  // Area cost = level*2 SL :contentReference[oaicite:11]{index=11}
  // Totem cost = level*3 SL :contentReference[oaicite:12]{index=12}
  // Damage cost = level*2 SL :contentReference[oaicite:13]{index=13}
  let cost = 0;

  if(vectorId === "dart") cost += 1;
  if(vectorId === "area") cost += areaLevel * 2;
  if(vectorId === "dart_plus_area") cost += 1 + areaLevel * 2;
  if(vectorId === "totem") cost += totemLevel * 3;

  cost += damageLevel * 2;
  return cost;
}

function addSpell(){
  const name = el("spellName").value.trim();
  if(!name) return alert("Spell name required.");

  const vectorId = el("spellVector").value;
  const effectIds = selectedMultiIds(el("spellEffects"));
  if(effectIds.length === 0) return alert("Select at least one effect.");

  const areaLevel = clampInt(el("spellAreaLevel").value, 0);
  const damageLevel = clampInt(el("spellDamageLevel").value, 0);
  const totemLevel = clampInt(el("spellTotemLevel").value, 0);

  const vector = (DB.vectors.vectors || []).find(v => v.id === vectorId);
  const effects = effectIds.map(id => (DB.effects.effects || []).find(e => e.id === id)).filter(Boolean);

  const slCost = spellCostSL(vectorId, areaLevel, damageLevel, totemLevel);

  state.spells.push({
    id: uid(),
    name,
    vector: vector ? { id: vector.id, name: vector.name } : { id: vectorId, name: vectorId },
    effects: effects.map(e => ({ id:e.id, name:e.name })),
    levels: { areaLevel, damageLevel, totemLevel },
    slCost,
    text: el("spellText").value.trim()
  });

  clearSpellForm();
  saveState();
  renderAll();
}

function clearSpellForm(){
  el("spellName").value = "";
  el("spellText").value = "";
  el("spellAreaLevel").value = "";
  el("spellDamageLevel").value = "";
  el("spellTotemLevel").value = "";
  Array.from(el("spellEffects").options).forEach(o => o.selected = false);
}

function removeSpell(spellId){
  state.spells = state.spells.filter(s => s.id !== spellId);
  saveState();
  renderAll();
}

/* ---------- Actions & Reactions ---------- */

function unarmedDamage(){
  const mgt = clampInt(state.meta.chars.mgt, 1);
  return Math.max(1, Math.floor(mgt / 3)); // :contentReference[oaicite:14]{index=14}
}

function buildActionsAndReactions(){
  const d = computeDerived();
  const actions = [];
  const reactions = [];

  // Core actions
  actions.push({ name:"Move", cost:"1 AP", text:`Move up to ${d.movePerAP} hexes.` });

  actions.push({ name:"Run", cost:"2 AP", text:`Move: double base movement + Agility. (Base = ${d.movePerAP})` }); // :contentReference[oaicite:15]{index=15}

  // Attacks (unarmed always)
  actions.push({ name:"Attack (Unarmed)", cost:"1 AP", text:`Damage: ${unarmedDamage()} (floor(Might/3), min 1). Skill: Melee.` });

  // Equipped weapons
  for(const w of equippedWeaponList()){
    actions.push({
      name:`Attack (${w.name})`,
      cost:`${w.apCost} AP`,
      text:`Damage: ${w.damage}. Skill: ${w.skill || (w.kind==="ranged" ? "Ranged" : "Melee")}.`
    });
  }

  // Reactions baseline: Dodge uses RAP, costs 1 (doc) :contentReference[oaicite:16]{index=16}
  reactions.push({ name:"Dodge", cost:"1 RAP", text:`Roll Dodge. On success: DR = Success Level. Crit success: 0 damage.` });

  // Trait-granted actions/reactions
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
  // list
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

  const sel = el("skillSelect");
  const chosen = sel.value || (names[0] || "");
  const current = chosen ? clampInt(state.skills[chosen], 0) : 0;
  el("skillCostHint").textContent = chosen
    ? `Increase ${chosen}: costs ${current} XP (current value).`
    : "No skills found.";
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
    const fx = (sp.effects || []).map(e=>e.name).join(", ");
    left.innerHTML = `<div class="title">${sp.name}</div><div class="sub">${sp.vector?.name || "—"} • ${fx} • Cost: ${sp.slCost} SL</div>`;

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

  el("sheetMeta").textContent =
    `${state.meta.concept || "—"} • ${species?.name || "—"} • XP: ${xpSpent()}/${clampInt(state.meta.xpBudget,0)} (rem ${xpRemaining()})`;

  const c = state.meta.chars;
  el("sheetChars").textContent =
`Might ${c.mgt}
Agility ${c.agi}
Wits ${c.wit}
Toughness ${c.tgh}
Mental ${c.mtl}`;

  el("sheetDerived").textContent =
`HP ${d.hp}
AP ${d.ap}
RAP ${d.rap}
Movement per 1 AP: ${d.movePerAP} hexes`;

  // Skills
  const skillLines = Object.keys(state.skills || {}).sort((a,b)=>a.localeCompare(b))
    .map(k => `${k}: ${state.skills[k]}`)
    .join("\n");
  el("sheetSkills").textContent = skillLines || "—";

  // Traits
  const traitLines = ownedTraits().map(t => `- ${t.name}`).join("\n");
  el("sheetTraits").textContent = traitLines || "—";

  // Equip
  const eqLines = (state.equipment || []).map(it => {
    const mark = it.equipped ? "[E]" : "[ ]";
    if(it.type === "armor") return `${mark} ${it.data.name} (Armor DR ${it.data.dr})`;
    return `${mark} ${it.data.name} (${it.data.apCost} AP, ${it.data.damage})`;
  }).join("\n");
  el("sheetEquip").textContent = eqLines || "—";

  // Actions & reactions
  const ar = buildActionsAndReactions();
  el("sheetAPTotal").textContent = String(ar.derived.ap);
  el("sheetRAPTotal").textContent = String(ar.derived.rap);

  el("sheetActions").textContent = ar.actions.map(a => `- ${a.name} — ${a.cost}\n  ${a.text}`).join("\n");
  el("sheetReactions").textContent = ar.reactions.map(r => `- ${r.name} — ${r.cost}\n  ${r.text}`).join("\n");

  // Spells
  if((state.spells || []).length === 0){
    el("sheetSpells").textContent = "—";
  }else{
    el("sheetSpells").textContent = state.spells.map(sp => {
      const fx = (sp.effects||[]).map(e=>e.name).join(", ");
      const levels = sp.levels ? `Area ${sp.levels.areaLevel}, Damage ${sp.levels.damageLevel}, Totem ${sp.levels.totemLevel}` : "";
      const text = sp.text ? `\n  ${sp.text}` : "";
      return `- ${sp.name} (${sp.vector?.name || "—"}) [${sp.slCost} SL]\n  Effects: ${fx}${levels ? "\n  " + levels : ""}${text}`;
    }).join("\n");
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
  renderSpells();
  renderSheet();
}

/* ---------- Buttons / binds ---------- */

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
      saveState();
      ensureSkillsInitialized();
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
      "If you're opening the file directly, use GitHub Pages or a local server.\n\n" +
      String(e)
    );
    console.error(e);
    return;
  }

  ensureSkillsInitialized();

  rebuildSpecies();
  rebuildTraits();
  rebuildEquipment();
  rebuildSpellsBuilder();

  bindUI();
  renderAll();
}

init();
