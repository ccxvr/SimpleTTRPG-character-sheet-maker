let SPECIES, TRAITS, EQUIPMENT, VECTORS, EFFECTS;

let state = {
  meta: {
    name: "",
    speciesId: "human",
    stats: { might:0, agility:0, wit:0, will:0 },
    toughness: 0
  },
  traits: [],
  weapons: [],
  spells: []
};

async function loadData() {
  SPECIES = await fetch("data/species.json").then(r=>r.json());
  TRAITS = await fetch("data/traits.json").then(r=>r.json());
  EQUIPMENT = await fetch("data/equipment.json").then(r=>r.json());
  VECTORS = await fetch("data/spell_vectors.json").then(r=>r.json());
  EFFECTS = await fetch("data/spell_effects.json").then(r=>r.json());

  initUI();
  render();
}

function initUI() {
  const sSel = document.getElementById("species");
  SPECIES.species.forEach(s=>{
    let o=document.createElement("option");
    o.value=s.id; o.textContent=s.name;
    sSel.appendChild(o);
  });

  const tSel=document.getElementById("traitSelect");
  TRAITS.traits.forEach(t=>{
    let o=document.createElement("option");
    o.value=t.id; o.textContent=t.name;
    tSel.appendChild(o);
  });

  const wSel=document.getElementById("weaponSelect");
  EQUIPMENT.equipment.weapons.forEach(w=>{
    let o=document.createElement("option");
    o.value=w.id; o.textContent=w.name;
    wSel.appendChild(o);
  });

  const vSel=document.getElementById("spellVector");
  VECTORS.vectors.forEach(v=>{
    let o=document.createElement("option");
    o.value=v.id; o.textContent=v.name;
    vSel.appendChild(o);
  });

  const eSel=document.getElementById("spellEffects");
  EFFECTS.effects.forEach(e=>{
    let o=document.createElement("option");
    o.value=e.id; o.textContent=e.name;
    eSel.appendChild(o);
  });

  document.querySelectorAll("input,select").forEach(el=>{
    el.addEventListener("input",updateState);
  });
}

function updateState() {
  state.meta.name = name.value;
  state.meta.speciesId = species.value;
  state.meta.stats.might = parseInt(might.value)||0;
  state.meta.stats.agility = parseInt(agility.value)||0;
  state.meta.stats.wit = parseInt(wit.value)||0;
  state.meta.stats.will = parseInt(will.value)||0;
  state.meta.toughness = parseInt(toughness.value)||0;
  render();
}

function computeTotals(){
  let m=state.meta.stats.might;
  let a=state.meta.stats.agility;
  let w=state.meta.stats.wit;
  let t=state.meta.toughness;

  let species = SPECIES.species.find(s=>s.id===state.meta.speciesId);
  let baseMove = species.base.move;

  return {
    hp: t + Math.floor(m/2),
    ap: 3 + Math.floor(a/3),
    rap: Math.floor(w/3),
    move: baseMove + Math.floor(a/3)
  };
}

function addTrait(){
  let id=traitSelect.value;
  let trait=TRAITS.traits.find(t=>t.id===id);
  state.traits.push(trait);
  render();
}

function addWeapon(){
  let id=weaponSelect.value;
  let w=EQUIPMENT.equipment.weapons.find(x=>x.id===id);
  state.weapons.push(w);
  render();
}

function addSpell(){
  let name=spellName.value;
  let vec=spellVector.value;
  let eff=[...spellEffects.selectedOptions].map(o=>o.textContent);
  state.spells.push({name,vec,eff,text:spellText.value});
  spellName.value="";
  spellText.value="";
  render();
}

function buildActions(totals){
  let actions=[];
  actions.push(`Move (1 AP): Move up to ${totals.move}`);

  let unarmed=Math.max(1,Math.floor(state.meta.stats.might/3));
  actions.push(`Unarmed Attack (1 AP): ${unarmed} damage`);

  state.weapons.forEach(w=>{
    actions.push(`Attack (${w.name}) (${w.apCost||1} AP): ${w.damage}`);
  });

  state.traits.forEach(t=>{
    if(t.grants?.actions){
      t.grants.actions.forEach(a=>{
        actions.push(`${a.name} (${a.apCost} AP)`);
      });
    }
  });

  return actions;
}

function buildReactions(totals){
  let reactions=[];
  state.traits.forEach(t=>{
    if(t.grants?.reactions){
      t.grants.reactions.forEach(r=>{
        reactions.push(`${r.name} (${r.rapCost} RAP)`);
      });
    }
  });
  return reactions;
}

function render(){
  let totals=computeTotals();

  document.getElementById("traitList").innerHTML=
    state.traits.map(t=>t.name).join("<br>");

  document.getElementById("weaponList").innerHTML=
    state.weapons.map(w=>w.name).join("<br>");

  document.getElementById("spellList").innerHTML=
    state.spells.map(s=>s.name).join("<br>");

  let actions=buildActions(totals);
  let reactions=buildReactions(totals);

  document.getElementById("printArea").textContent=
`Name: ${state.meta.name}
Species: ${state.meta.speciesId}

Might: ${state.meta.stats.might}
Agility: ${state.meta.stats.agility}
Wit: ${state.meta.stats.wit}
Will: ${state.meta.stats.will}
Toughness: ${state.meta.toughness}

HP: ${totals.hp}
AP: ${totals.ap}
RAP: ${totals.rap}
Move: ${totals.move}

TRAITS:
${state.traits.map(t=>"- "+t.name).join("\n")}

WEAPONS:
${state.weapons.map(w=>"- "+w.name).join("\n")}

ACTIONS:
${actions.map(a=>"- "+a).join("\n")}

REACTIONS:
${reactions.map(r=>"- "+r).join("\n")}

SPELLS:
${state.spells.map(s=>"- "+s.name+" ("+s.vec+")").join("\n")}
`;
}

loadData();
