// Rift Tamers — cola do jogo: loop, batalhas ao vivo em 3D, painéis, modais, save e progresso offline.
import { Game, newState, SAVE_KEY, ZONES, ZONE_LEN, UPGRADES, PERK_DEFS, upgradeCost, fmt, COLLAPSE_MIN_STAGE, EXPEDITION_UNLOCK, EXPEDITION_FLOORS, MAX_KEYS, KEY_PERIOD_S, BATTLE_OVERHEAD, ACHIEVEMENTS, rewardText } from './game.js';
import { sfx, unlockAudio, setSound } from './sfx.js';
import { step, triggerSync, SYNC_MAX, alive } from './battle.js';
import { TYPE_INFO, TYPES, RELICS, STATUS_INFO, multiEffectiveness } from './data.js';
import { statsOf, power, movesOf, RARITIES, RARITY_INDEX, ALL_SPECIES, speciesName, displayName, xpToNext, BODY_INFO, evoStage, EVO_LEVELS, formName } from './genome.js';
import { Stage3D, portrait } from './render/scene.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rarity = (g) => RARITIES[RARITY_INDEX[g.rarity]];
const typeTag = (t) => `<span class="type" style="background:${TYPE_INFO[t].color}">${TYPE_INFO[t].name}</span>`;
const nameHtml = (g) => `<span class="${g.prismatic ? 'prism' : ''}">${g.prismatic ? '✦ ' : ''}${esc(displayName(g))}</span>`;
const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* sem armazenamento */ } },
};

// ---------- carregar ----------
let game;
const params = new URLSearchParams(location.search);
try { const raw = store.get(SAVE_KEY); game = raw && !params.has('new') ? Game.deserialize(raw) : new Game(newState(params.get('seed') || undefined)); }
catch (e) { console.warn('save corrompido, novo jogo', e); game = new Game(newState()); }
const S = () => game.s;

let stage3d;
try { stage3d = new Stage3D($('#stage'), { quality: S().settings.quality, onPopup, onLayout: () => showBattleMeshes() }); }
catch (e) { document.body.innerHTML = '<div class="err"><h2>WebGL indisponível</h2><p>Este navegador não conseguiu iniciar o 3D. Tente o Chrome, Edge, Firefox ou Safari atualizados.</p></div>'; throw e; }

// ---------- retratos 3D em fila (não trava a interface) ----------
const portraitQueue = [];
function lazyPortrait(img, g) { img.dataset.pid = g.id; portraitQueue.push({ img, g }); }
function pumpPortraits() { for (let i = 0; i < 3 && portraitQueue.length; i++) { const { img, g } = portraitQueue.shift(); if (img.isConnected && img.dataset.pid === g.id) img.src = portrait(g); } }
const imgFor = (g) => `<img alt="" data-lazy="${g.id}">`;
function hydrate(root) { root.querySelectorAll('img[data-lazy]').forEach(img => { const g = game.byId(img.dataset.lazy) || ctxCreatures.get(img.dataset.lazy); if (g) lazyPortrait(img, g); img.removeAttribute('data-lazy'); }); }
const ctxCreatures = new Map();      // genomas fora do save (iniciais, inimigos) que aparecem em retratos

// ---------- batalha ao vivo ----------
let ctx = null;           // { kind: 'stage'|'exp', battle, enemies, stage, endAt }
let view = 'arena', speed = 1, lastFrame = performance.now(), saveTimer = 0, hudTimer = 0, achTimer = 2;
const unitEls = new Map();

function startBattle() {
    if (!S().starterChosen || !S().team.length) { ctx = null; return; }
    if (S().expedition && !S().expedition.choices) {
        const r = game.makeExpeditionBattle(); if (!r) { ctx = null; return; }
        ctx = { kind: 'exp', battle: r.battle, enemies: r.enemies, floor: S().expedition.floor };
        stage3d.setIsland('rift', S().expedition.seed);
    } else if (S().expedition) { ctx = null; return; }
    else {
        const r = game.makeStageBattle();
        ctx = { kind: 'stage', battle: r.battle, enemies: r.enemies, stage: r.stage };
        if (view !== 'sanctuary') stage3d.setIsland(game.zoneOf(r.stage).type, S().seed + ':z' + Math.floor((r.stage - 1) / ZONE_LEN));
    }
    for (const e of ctx.enemies) ctxCreatures.set(e.id, e);
    if (view !== 'sanctuary') showBattleMeshes();
}
function showBattleMeshes() {
    if (!ctx) { stage3d.clearCreatures(); clearUnits(); return; }
    const a = ctx.battle.units.filter(u => u.side === 'A').map(u => u.g), b = ctx.battle.units.filter(u => u.side === 'B').map(u => u.g);
    stage3d.showBattle(a, b);
    for (const u of ctx.battle.units) if (!u.alive) { const m = stage3d.meshes.get(u.id); if (m) m.visible = false; }
    buildUnits();
}
function clearUnits() { for (const el of unitEls.values()) el.remove(); unitEls.clear(); }
function buildUnits() {
    clearUnits();
    if (!ctx) return;
    for (const u of ctx.battle.units) {
        const el = document.createElement('div');
        el.className = 'unit' + (u.side === 'B' ? ' foe' : '') + (u.g.boss ? ' boss' : '');
        el.innerHTML = `<div class="nm">${u.g.boss ? '♛ ' : ''}${nameHtml(u.g)} <em>Nv${u.g.level}</em></div><div class="hp"><i></i></div><div class="en">${'<b></b>'.repeat(5)}</div><div class="st"></div>`;
        $('#overlay').appendChild(el); unitEls.set(u.id, el);
    }
}
function updateUnits() {
    if (!ctx || view === 'sanctuary') return;
    const anchors = stage3d.anchors();
    for (const u of ctx.battle.units) {
        const el = unitEls.get(u.id), a = anchors[u.id]; if (!el || !a) continue;
        el.style.left = a.x + 'px'; el.style.top = a.y + 'px';
        el.classList.toggle('dead', !u.alive || !a.visible);
        const r = u.hp / u.maxHp, bar = el.querySelector('.hp i');
        bar.style.width = (r * 100).toFixed(1) + '%'; bar.classList.toggle('mid', u.side === 'A' && r < 0.35);
        const pips = el.querySelectorAll('.en b'); pips.forEach((p, i) => p.classList.toggle('on', u.energy >= (i + 1) * 1));
        el.querySelector('.st').textContent = Object.keys(u.status).map(k => STATUS_INFO[k]?.name || k).join(' · ');
    }
}
function onPopup(text, mesh, kind, e) {
    if (view === 'sanctuary') return;
    if (e && e.tier === 'ult') sfx('ult'); else if (kind === 'crit' || kind === 'super' || kind === 'hit') sfx(kind, { pitch: 0.8 + Math.random() * 0.4 });
    const a = stage3d.anchor(mesh, 1.6); if (!a.visible) return;
    const el = document.createElement('div');
    el.className = 'pop ' + kind;
    el.textContent = typeof text === 'number' ? fmt(text) + (kind === 'crit' ? '!' : '') : kind === 'status' ? (STATUS_INFO[text]?.name || text) : text;
    el.style.left = (a.x + (Math.random() - 0.5) * 40) + 'px'; el.style.top = a.y + 'px';
    $('#overlay').appendChild(el); setTimeout(() => el.remove(), 1000);
}
function finishBattle() {
    const b = ctx.battle;
    if (ctx.kind === 'stage') {
        const r = game.resolveStage(ctx.stage, ctx.enemies, b.result);
        if (r.result === 'A') { toastStage(r); } else log(`Derrota no estágio ${ctx.stage}. Treinando no anterior antes de tentar de novo.`, 'bad');
    } else {
        const r = game.resolveExpedition(b);
        if (S().expedition && S().expedition.choices) openRelicChoice();
        else if (!S().expedition) ctx = null;
        void r;
    }
}

function frame() {
    const now = performance.now(); let dt = (now - lastFrame) / 1000; lastFrame = now;
    if (dt > 5) { runOfflineGap(dt); dt = 0; }        // aba voltou depois de ficar em segundo plano
    dt = Math.min(dt, 0.1);
    game.passiveTick(dt);
    S().lastTick = Date.now();
    if (ctx && !ctx.endAt) {
        if (game.perk('autosync') && S().settings.autoSync && ctx.battle.sync >= SYNC_MAX) triggerSync(ctx.battle);
        const ev = step(ctx.battle, dt * speed);
        if (view !== 'sanctuary') {
            stage3d.playEvents(ev);
            for (const e of ev) { if (e.t === 'faint') sfx('faint'); else if (e.t === 'sync') sfx('sync'); else if (e.t === 'end') sfx(e.result === 'A' ? 'win' : 'lose'); }
        }
        if (ctx.battle.result) ctx.endAt = now + (BATTLE_OVERHEAD * 1000) / speed;
    } else if (ctx && ctx.endAt && now >= ctx.endAt) { finishBattle(); pendingRebuild = false; if (!S().expedition || !S().expedition.choices) startBattle(); }
    else if (!ctx && S().starterChosen && !modalOpen() && (!S().expedition || !S().expedition.choices)) startBattle();
    stage3d.render();
    updateUnits(); updateSync(); pumpPortraits();
    hudTimer -= dt; if (hudTimer <= 0) { hudTimer = 0.25; updateHud(); }
    saveTimer -= dt; if (saveTimer <= 0) { saveTimer = 10; save(); }
    achTimer -= dt; if (achTimer <= 0) { achTimer = 2; game.checkAchievements(); }
    requestAnimationFrame(frame);
}

function runOfflineGap(seconds, showReport = seconds > 120) {
    if (!S().starterChosen) return;
    if (S().expedition) { game.passiveTick(Math.min(seconds, game.offlineCapSeconds())); return; }
    const sum = game.runOffline(seconds);
    ctx = null;
    if (showReport && sum.battles > 0) openOfflineReport(sum);
    renderPanel();
}
function save() { S().lastTick = Date.now(); store.set(SAVE_KEY, game.serialize()); }
addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ---------- HUD ----------
function chip(icon, color, val, label, extra = '') { return `<span class="chip" title="${label}"><i style="background:${color}">${icon}</i>${val}${extra}</span>`; }
function updateHud() {
    const s = S(), r = game.sanctuaryRate();
    $('#resources').innerHTML =
        chip('◆', '#7af7ff', fmt(s.essence), 'Essência: compra melhorias e orbes', r.essence > 0 ? ` <small>+${fmt(r.essence)}/s</small>` : '') +
        chip('⧉', '#6dffa8', fmt(s.dna), 'DNA: usado na fusão') +
        chip('●', '#ff6a9a', fmt(s.orbs), 'Orbes de captura') +
        chip('⟁', '#ffcf5a', s.keys + '/' + MAX_KEYS, 'Chaves da Fenda: abrem expedições (1 por hora)') +
        (s.shards || s.stats.collapses ? chip('✦', '#ff4fd8', fmt(s.shards), 'Estilhaços (prestígio)') : '');
    if (ctx && ctx.kind === 'exp') {
        $('#zone-name').textContent = 'Expedição na Fenda'; $('#zone-stage').textContent = `Andar ${S().expedition ? S().expedition.floor : '—'}/${EXPEDITION_FLOORS}`;
        $('#stage-progress i').style.width = ((S().expedition ? S().expedition.floor - 1 : EXPEDITION_FLOORS) / EXPEDITION_FLOORS * 100) + '%';
    } else {
        const z = game.zoneOf(s.stage), inZone = ((s.stage - 1) % ZONE_LEN) + 1, tier = game.zoneTier(s.stage);
        $('#zone-name').textContent = z.name + (tier ? ' · Ciclo ' + (tier + 1) : '');
        $('#zone-stage').innerHTML = `${game.isBoss(s.stage) ? '♛ ' : ''}Estágio ${s.stage} <small style="font-size:11px;color:var(--mute)">${s.farmUntil ? 'treinando' : ''}</small>`;
        $('#stage-progress i').style.width = (inZone / ZONE_LEN * 100) + '%';
    }
    const t = game.tide(), rem = Math.ceil(game.tideRemaining() / 1000);
    $('#tide').innerHTML = `<small>Maré da Fenda</small><b style="color:${TYPE_INFO[t.type].color}">${TYPE_INFO[t.type].name} +25%</b><small>${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}</small>`;
    $('#btn-push').classList.toggle('on', s.autoPush);
    $('#btn-next').disabled = s.stage >= s.maxStage || !!s.expedition;
    $('#btn-prev').disabled = s.stage <= 1 || !!s.expedition;
    // indicadores nas abas
    const dot = (tab, on) => { const b = $(`#tabs [data-tab="${tab}"]`); let d = b.querySelector('.dot'); if (on && !d) { d = document.createElement('i'); d.className = 'dot'; b.appendChild(d); } if (!on && d) d.remove(); };
    dot('upgrades', UPGRADES.some(u => game.up(u.id) < u.max && s.essence >= upgradeCost(u, game.up(u.id))));
    dot('expedition', game.canExpedition());
    dot('collapse', game.collapseReward() > 0);
    dot('team', s.creatures.length > s.team.length && s.team.length < game.teamSize());
    if (activeTab && liveTabs.has(activeTab)) renderPanel(true);
}
function updateSync() {
    const v = ctx && ctx.kind ? ctx.battle.sync / SYNC_MAX : 0;
    $('#sync-ring').style.strokeDashoffset = String(276.5 * (1 - v));
    $('#btn-sync').classList.toggle('ready', v >= 1 && ctx && !ctx.battle.result);
}

// ---------- registro e toasts ----------
function log(msg, kind = 'info') {
    const el = document.createElement('div'); el.className = kind; el.textContent = msg;
    const box = $('#log'); box.prepend(el); while (box.children.length > 6) box.lastChild.remove();
    setTimeout(() => el.remove(), 9000);
}
game.on((type, d) => {
    if (type === 'log') log(d.msg, d.kind);
    if (type === 'capture') { toastCapture(d.g, d.isNew); sfx(d.g.prismatic ? 'prism' : 'capture'); }
    if (type === 'evolve') { sfx('evolve'); toast(`${imgFor(d.g)}<div><b>EVOLUÇÃO!</b><small>${esc(d.g.name)} → ${nameHtml(d.g)} · forma ${d.stage + 1}</small></div>`, 'prism'); pendingRebuild = true; }
    if (type === 'achievement') { sfx('achieve'); toast(`<div style="font-size:30px;padding:4px 8px">🏆</div><div><b>${d.name}</b><small>${d.desc} · ${rewardText(d.reward)}</small></div>`); }
    if (type === 'team' || type === 'fusion' || type === 'collapse' || type === 'expeditionEnd') { if (activeTab) renderPanel(); }
    if (type === 'expeditionEnd') openExpeditionEnd(d);
});
function toast(html, cls = '') { const el = document.createElement('div'); el.className = 'toast ' + cls; el.innerHTML = html; $('#toasts').appendChild(el); hydrate(el); setTimeout(() => el.remove(), 3700); while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove(); }
function toastCapture(g, isNew) { toast(`${imgFor(g)}<div><b>${nameHtml(g)} capturado!</b><small>${rarity(g).name} · Nv${g.level}${isNew ? ' · NOVA ESPÉCIE' : ''}</small></div>`, g.prismatic ? 'prism' : ''); }
function toastStage(r) { if (r.levelUps) log(`Vitória no estágio ${r.stage}: +${fmt(r.essence)} Essência, ${r.levelUps} nível(is) na equipe.`, 'good'); }

// ---------- barra de batalha ----------
$('#btn-sync').onclick = () => { if (ctx && triggerSync(ctx.battle)) log('SINCRONIA! Toda a equipe age agora.', 'good'); };
$('#btn-speed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 3 : 1; $('#btn-speed').textContent = speed + '×'; };
$('#btn-push').onclick = () => { S().autoPush = !S().autoPush; updateHud(); };
$('#btn-prev').onclick = () => { if (S().stage > 1) { S().stage--; S().farmUntil = 0; S().autoPush = false; ctx = null; startBattle(); updateHud(); } };
$('#btn-next').onclick = () => { if (S().stage < S().maxStage) { S().stage++; S().farmUntil = 0; ctx = null; startBattle(); updateHud(); } };

// ---------- abas e painéis ----------
let activeTab = null, pendingRebuild = false;
const liveTabs = new Set(['upgrades', 'collapse', 'expedition']);
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => selectTab(b.dataset.tab));
$('#panel-close').onclick = () => selectTab('arena');
function selectTab(tab) {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const wasSanct = view === 'sanctuary';
    if (tab === 'arena') { activeTab = null; $('#panel').hidden = true; document.body.classList.remove('panel-open'); stage3d.setPanelOffset(0); }
    else { activeTab = tab; $('#panel').hidden = false; document.body.classList.add('panel-open'); renderPanel(); stage3d.setPanelOffset(464); }
    sfx('ui');
    view = tab === 'sanctuary' ? 'sanctuary' : 'arena';
    if (view === 'sanctuary' && !wasSanct) { clearUnits(); stage3d.setIsland('bloom', S().seed + ':sanct'); stage3d.showSanctuary(sanctuaryGenomes()); }
    if (view === 'arena' && wasSanct) { if (ctx) { stage3d.setIsland(ctx.kind === 'exp' ? 'rift' : game.zoneOf(ctx.stage).type, ctx.kind === 'exp' ? S().expedition.seed : S().seed + ':z' + Math.floor((ctx.stage - 1) / ZONE_LEN)); } showBattleMeshes(); }
}
const sanctuaryGenomes = () => S().creatures.filter(c => !S().team.includes(c.id)).sort((a, b) => power(b) - power(a));
let lastPanelHtml = '';
function renderPanel(soft = false) {
    if (!activeTab) return;
    const titles = { team: 'Equipe', sanctuary: 'Santuário', lab: 'Laboratório de Fusão', expedition: 'Expedição na Fenda', dex: 'Genodex', upgrades: 'Evoluir', collapse: 'Colapso da Fenda', settings: 'Ajustes' };
    $('#panel-title').textContent = titles[activeTab];
    const html = PANELS[activeTab]();
    if (soft && html === lastPanelHtml) return;
    const body = $('#panel-body'), scroll = body.scrollTop;
    body.innerHTML = html; lastPanelHtml = html; body.scrollTop = scroll;
    hydrate(body); bindPanel(body);
}
let sanctFilter = 'all', teamSort = 'power', labPick = [];
const creatureCard = (g, extra = '') => `<div class="card ${S().team.includes(g.id) ? 'inteam' : ''} ${extra}" data-cid="${g.id}">${g.locked ? '<span class="lock">🔒</span>' : ''}${imgFor(g)}<div class="n">${nameHtml(g)}</div><div class="types">${g.types.map(typeTag).join('')}</div><div class="m"><span class="rar" style="color:${rarity(g).color}">${rarity(g).name}</span> · Nv${g.level}</div><div class="m">⚡ ${fmt(power(g, modsFor()))}</div></div>`;
const modsFor = () => { const m = game.playerMods(); return { atk: m.dmg, hp: m.hp, spd: m.spd }; };
const sorted = (list) => [...list].sort(teamSort === 'level' ? (a, b) => b.level - a.level : teamSort === 'rarity' ? (a, b) => RARITY_INDEX[b.rarity] - RARITY_INDEX[a.rarity] || power(b) - power(a) : (a, b) => power(b) - power(a));

const PANELS = {
    team() {
        const team = game.teamGenomes(), others = sorted(S().creatures.filter(c => !S().team.includes(c.id)));
        return `<p class="note">Toque numa criatura para ver detalhes. Equipe ${team.length}/${game.teamSize()} · Poder total <b>⚡ ${fmt(game.teamPower())}</b></p>
        <div class="grid">${team.map(g => creatureCard(g)).join('')}</div>
        <div class="section-title">Reserva (${others.length})</div>
        <div class="filters">${['power', 'level', 'rarity'].map(k => `<button data-sort="${k}" class="${teamSort === k ? 'on' : ''}">${{ power: 'Poder', level: 'Nível', rarity: 'Raridade' }[k]}</button>`).join('')}
        <button data-autoteam>Montar melhor equipe</button></div>
        <div class="grid">${others.slice(0, 80).map(g => creatureCard(g)).join('')}</div>${others.length > 80 ? '<p class="note">Mostrando as 80 primeiras.</p>' : ''}`;
    },
    sanctuary() {
        const list = sanctuaryGenomes(), r = game.sanctuaryRate();
        const shown = sanctFilter === 'all' ? list : list.filter(g => g.types.includes(sanctFilter));
        return `<div class="row"><div><h4>Produção do Santuário</h4><p>As criaturas fora da equipe vivem aqui e geram recursos mesmo offline.</p></div><div style="text-align:right"><b>+${fmt(r.essence)}/s</b><p>Essência</p><b>+${r.dna.toFixed(2)}/s</b><p>DNA</p></div></div>
        <p class="note">Ocupação: ${list.length}/${game.sanctuaryCap()} · Quando lota, as mais fracas (sem 🔒) viram DNA.</p>
        <div class="filters"><button data-sf="all" class="${sanctFilter === 'all' ? 'on' : ''}">Todos</button>${TYPES.map(t => `<button data-sf="${t}" class="${sanctFilter === t ? 'on' : ''}" style="color:${TYPE_INFO[t].color}">${TYPE_INFO[t].name}</button>`).join('')}</div>
        <div class="grid">${shown.slice(0, 80).map(g => creatureCard(g)).join('')}</div>`;
    },
    lab() {
        const [a, b] = labPick.map(id => game.byId(id));
        const prev = a && b ? game.fusePreview(a.id, b.id) : null;
        const slot = (g, i) => `<div class="fuse-slot" data-slot="${i}">${g ? imgFor(g) : 'Escolha<br>uma criatura'}</div>`;
        const list = sorted(S().creatures).filter(g => !labPick.includes(g.id));
        return `<p class="note">Funda duas criaturas: a filha herda os genes de cada uma (corpo, cores, padrões, tipos) e o MAIOR potencial de cada atributo. Raridades iguais têm 60% de chance de subir um nível. Pais prismáticos passam 12% de chance de brilho. 10% de chance de mutação.</p>
        <div class="fuse-slots">${slot(a, 0)}<div class="fuse-plus">+</div>${slot(b, 1)}</div>
        ${prev ? `<div class="row"><div><h4>Previsão</h4><p>Raridade mínima: ${prev.minRarity}${prev.upChance ? ' · 60% de subir' : ''}<br>Tipos possíveis: ${prev.types.map(typeTag).join(' ')}<br>Chance prismática: ${(prev.prismChance * 100).toFixed(2)}%</p></div><button class="primary" data-fuse ${S().dna < prev.cost ? 'disabled' : ''}>Fundir<br><small>⧉ ${fmt(prev.cost)} DNA</small></button></div>` : ''}
        <div class="section-title">Suas criaturas · DNA ${fmt(S().dna)}</div>
        <div class="grid">${list.slice(0, 80).map(g => creatureCard(g)).join('')}</div>`;
    },
    expedition() {
        const s = S(), ex = s.expedition;
        if (s.maxStageEver < EXPEDITION_UNLOCK) return `<p class="note">A Fenda abre no estágio ${EXPEDITION_UNLOCK}. Continue avançando.</p>`;
        if (ex) {
            return `<div class="row"><div><h4>Andar ${ex.floor} de ${EXPEDITION_FLOORS}</h4><p>Vida não se recupera entre lutas (25% por andar; cura total a cada 3). Chefes nos andares 5 e 10.</p></div><div class="big">${ex.floor}</div></div>
            <div class="section-title">Relíquias</div><div class="relics">${Object.entries(ex.relics).map(([id, n]) => `<span class="relic">${RELICS.find(r => r.id === id).name} ×${n}</span>`).join('') || '<span class="note">Nenhuma ainda.</span>'}</div>
            <div class="section-title">Saque acumulado</div><p class="note">◆ ${fmt(ex.rewards.essence)} Essência · ⧉ ${fmt(ex.rewards.dna)} DNA · Ovo da Fenda a partir do andar 3</p>
            <div class="modal-actions"><button data-exp-quit>Encerrar e levar o saque</button></div>`;
        }
        const nextKey = s.keys < MAX_KEYS ? Math.ceil((KEY_PERIOD_S - s.keyTimer) / 60) + ' min' : 'cheio';
        return `<p class="note">Roguelike na Fenda: 10 andares com sua equipe atual. Depois de cada vitória, escolha 1 relíquia (elas se acumulam). Ao final, um <b>Ovo da Fenda</b> eclode com uma criatura rara, épica ou lendária. A progressão de estágios pausa enquanto você explora.</p>
        <div class="row"><div><h4>Chaves da Fenda: ${s.keys}/${MAX_KEYS}</h4><p>+1 por hora (próxima: ${nextKey}) e nos chefes de estágio múltiplo de 50.</p></div><button class="primary" data-exp-start ${game.canExpedition() ? '' : 'disabled'}>Entrar</button></div>
        <div class="section-title">Relíquias possíveis</div>${RELICS.map(r => `<div class="row"><div><h4>${r.name}</h4><p>${r.desc}</p></div></div>`).join('')}
        <p class="note">Melhor andar alcançado: ${s.stats.bestFloor}</p>`;
    },
    dex() {
        const caught = game.dexCount();
        return `<div class="row"><div><h4>${caught}/${ALL_SPECIES.length} espécies</h4><p>Cada espécie capturada dá +2% de ataque e vida à equipe; cada prismática, +3% a mais.</p></div><div class="big">+${Math.round((game.dexBonus() - 1) * 100)}%</div></div>
        <div class="dexgrid">${ALL_SPECIES.map(k => {
            const d = S().dex[k], [body, type] = k.split(':'), nm = speciesName(body, type);
            const own = S().creatures.find(c => c.species === k);
            if (d && d.caught && own) return `<div class="dex-cell" title="${nm} · ${BODY_INFO[body].name}">${imgFor(own)}<small class="${d.prismatic ? 'prism' : ''}">${nm}</small></div>`;
            return `<div class="dex-cell unk ${d ? 'seen' : ''}" title="${d ? nm + ' (visto)' : '???'}" style="${d ? 'border-color:' + TYPE_INFO[type].color : ''}">${d ? '◌' : '?'}<small>${d ? nm : '???'}</small></div>`;
        }).join('')}</div>
        <div class="section-title">Conquistas · ${Object.keys(S().achievements).length}/${ACHIEVEMENTS.length}</div>
        ${ACHIEVEMENTS.map(a => `<div class="row" style="${S().achievements[a.id] ? '' : 'opacity:.55'}"><div><h4>${S().achievements[a.id] ? '🏆 ' : ''}${a.name}</h4><p>${a.desc}</p></div><span class="note">${rewardText(a.reward)}</span></div>`).join('')}`;
    },
    upgrades() {
        const s = S();
        return `<p class="note">Gaste Essência para fortalecer a equipe. Tudo aqui é zerado no Colapso, exceto o Elo de Sincronia.</p>
        ${UPGRADES.map(u => { const l = game.up(u.id), c = upgradeCost(u, l), max = l >= u.max; return `<div class="row"><div><h4>${u.name} <span class="lv">Nv ${l}${u.max < 999 ? '/' + u.max : ''}</span></h4><p>${u.desc}</p></div><button data-up="${u.id}" ${max || s.essence < c ? 'disabled' : ''}>${max ? 'MÁX' : '◆ ' + fmt(c)}</button></div>`; }).join('')}
        <div class="section-title">Orbes de captura</div>
        <div class="row"><div><h4>Orbes: ${fmt(s.orbs)}</h4><p>Um orbe por tentativa. Política: ${{ smart: 'inteligente (novas espécies, raras+, alto potencial)', all: 'tudo', none: 'nada' }[s.capturePolicy]}</p></div><div style="display:grid;gap:6px"><button data-orbs="10" ${s.essence < game.orbPrice() * 10 ? 'disabled' : ''}>+10 · ◆ ${fmt(game.orbPrice() * 10)}</button><button data-orbs="50" ${s.essence < game.orbPrice() * 50 ? 'disabled' : ''}>+50 · ◆ ${fmt(game.orbPrice() * 50)}</button></div></div>
        <div class="filters">${['smart', 'all', 'none'].map(p => `<button data-policy="${p}" class="${s.capturePolicy === p ? 'on' : ''}">${{ smart: 'Inteligente', all: 'Capturar tudo', none: 'Não capturar' }[p]}</button>`).join('')}</div>`;
    },
    collapse() {
        const s = S(), gain = game.collapseReward();
        return `<p class="note">O Colapso da Fenda reinicia os estágios, a Essência, as melhorias e os níveis. Você <b>mantém</b> todas as criaturas, o Genodex, o DNA e ganha <b>Estilhaços</b> para perks permanentes. Disponível a partir do estágio ${COLLAPSE_MIN_STAGE}.</p>
        <div class="row"><div><h4>Recompensa agora: ✦ ${fmt(gain)}</h4><p>Estágio máximo deste ciclo: ${s.maxStage} · Colapsos: ${s.stats.collapses}</p></div><button class="primary" data-collapse ${gain > 0 ? '' : 'disabled'}>COLAPSAR</button></div>
        <div class="section-title">Perks permanentes · ✦ ${fmt(s.shards)}</div>
        ${PERK_DEFS.map(p => { const l = game.perk(p.id), c = upgradeCost(p, l), max = l >= p.max; return `<div class="row"><div><h4>${p.name} <span class="lv">Nv ${l}/${p.max}</span></h4><p>${p.desc}</p></div><button data-perk="${p.id}" ${max || s.shards < c ? 'disabled' : ''}>${max ? 'MÁX' : '✦ ' + fmt(c)}</button></div>`; }).join('')}`;
    },
    settings() {
        const s = S();
        return `<div class="section-title">Gráficos</div><div class="filters">${['low', 'medium', 'high'].map(q => `<button data-q="${q}" class="${s.settings.quality === q ? 'on' : ''}">${{ low: 'Leve', medium: 'Médio', high: 'Alto' }[q]}</button>`).join('')}</div>
        <p class="note">FPS atual: ${Math.round(stage3d.fps)}</p>
        <div class="section-title">Som</div><div class="filters"><button data-sound class="${s.settings.sound ? 'on' : ''}">Efeitos sonoros: ${s.settings.sound ? 'ligados' : 'desligados'}</button></div>
        ${game.perk('autosync') ? `<div class="filters"><button data-autosync class="${s.settings.autoSync ? 'on' : ''}">Sincronia automática: ${s.settings.autoSync ? 'ligada' : 'desligada'}</button></div>` : ''}
        <div class="section-title">Save</div>
        <div class="filters"><button data-export>Exportar save</button><button data-import>Importar save</button><button data-reset style="border-color:var(--bad)">Apagar tudo</button></div>
        <div class="section-title">Estatísticas</div>
        <p class="note">Batalhas ${fmt(s.stats.battles)} · Vitórias ${fmt(s.stats.wins)} · Capturas ${fmt(s.stats.captures)} · Prismáticos ${s.stats.prismatics} · Fusões ${s.stats.fusions} · Colapsos ${s.stats.collapses}<br>Tempo jogando ${Math.floor(s.stats.playSeconds / 3600)} h ${Math.floor(s.stats.playSeconds / 60) % 60} min · Offline simulado ${Math.floor(s.stats.offlineSeconds / 3600)} h<br>Semente do mundo: <code>${esc(s.seed)}</code></p>
        <div class="section-title">Sobre</div><p class="note">Rift Tamers é um jogo original de criaturas geradas por genoma, inspirado no gênero de monstros colecionáveis. Toda criatura, ilha e efeito é procedural, desenhado em tempo real com WebGL.</p>`;
    },
};

function bindPanel(root) {
    root.querySelectorAll('[data-cid]').forEach(el => el.onclick = () => {
        if (activeTab === 'lab') { if (labPick.length < 2) labPick.push(el.dataset.cid); renderPanel(); return; }
        openCreature(el.dataset.cid);
    });
    root.querySelectorAll('[data-slot]').forEach(el => el.onclick = () => { labPick.splice(Number(el.dataset.slot), 1); renderPanel(); });
    root.querySelectorAll('[data-sort]').forEach(el => el.onclick = () => { teamSort = el.dataset.sort; renderPanel(); });
    root.querySelectorAll('[data-sf]').forEach(el => el.onclick = () => { sanctFilter = el.dataset.sf; renderPanel(); });
    root.querySelectorAll('[data-up]').forEach(el => el.onclick = () => { if (game.buyUpgrade(el.dataset.up)) { sfx('buy'); renderPanel(); updateHud(); } });
    root.querySelectorAll('[data-perk]').forEach(el => el.onclick = () => { if (game.buyPerk(el.dataset.perk)) { sfx('buy'); renderPanel(); updateHud(); } });
    root.querySelectorAll('[data-orbs]').forEach(el => el.onclick = () => { if (game.buyOrbs(Number(el.dataset.orbs))) renderPanel(); });
    root.querySelectorAll('[data-policy]').forEach(el => el.onclick = () => { S().capturePolicy = el.dataset.policy; renderPanel(); });
    root.querySelectorAll('[data-q]').forEach(el => el.onclick = () => { S().settings.quality = el.dataset.q; stage3d.setQuality(el.dataset.q); renderPanel(); });
    const q = (s) => root.querySelector(s);
    if (q('[data-autoteam]')) q('[data-autoteam]').onclick = () => { game.setTeam(sorted(S().creatures).slice(0, game.teamSize()).map(c => c.id)); ctx = null; };
    if (q('[data-fuse]')) q('[data-fuse]').onclick = () => fuseAnimation();
    if (q('[data-exp-start]')) q('[data-exp-start]').onclick = () => { if (game.startExpedition()) { ctx = null; selectTab('arena'); log('Você entrou na Fenda. Boa sorte, domador.', 'prism'); } };
    if (q('[data-exp-quit]')) q('[data-exp-quit]').onclick = () => { game.endExpedition(false); ctx = null; };
    if (q('[data-collapse]')) q('[data-collapse]').onclick = () => confirmModal('Colapsar a Fenda?', `Você ganha ✦ ${game.collapseReward()} Estilhaços e recomeça do estágio ${1 + game.perk('warp') * 10}. Criaturas, Genodex e DNA ficam.`, 'COLAPSAR', () => { game.collapse(); ctx = null; renderPanel(); });
    if (q('[data-sound]')) q('[data-sound]').onclick = () => { S().settings.sound = !S().settings.sound; setSound(S().settings.sound); renderPanel(); };
    if (q('[data-autosync]')) q('[data-autosync]').onclick = () => { S().settings.autoSync = !S().settings.autoSync; renderPanel(); };
    if (q('[data-export]')) q('[data-export]').onclick = () => { const code = game.exportSave(); openModal(`<h2>Exportar save</h2><p class="note">Copie o código e guarde.</p><textarea style="width:100%;height:140px;background:#0b0820;color:#fff;border-radius:10px;border:1px solid var(--line)" readonly>${code}</textarea><div class="modal-actions"><button data-copy>Copiar</button><button data-close class="primary">Fechar</button></div>`, (card) => { card.querySelector('[data-copy]').onclick = () => navigator.clipboard?.writeText(code); }); };
    if (q('[data-import]')) q('[data-import]').onclick = () => openModal(`<h2>Importar save</h2><textarea id="imp" style="width:100%;height:140px;background:#0b0820;color:#fff;border-radius:10px;border:1px solid var(--line)"></textarea><div class="modal-actions"><button data-close>Cancelar</button><button class="primary" data-do>Importar</button></div>`, (card) => { card.querySelector('[data-do]').onclick = () => { try { game = Game.importSave(card.querySelector('#imp').value); bindGame(); store.set(SAVE_KEY, game.serialize()); location.reload(); } catch { alert('Código inválido.'); } }; });
    if (q('[data-reset]')) q('[data-reset]').onclick = () => confirmModal('Apagar tudo?', 'Seu progresso será perdido para sempre.', 'APAGAR', () => { store.del(SAVE_KEY); removeEventListener('beforeunload', save); location.search = '?new=1'; });
}
function bindGame() { /* o listener é recriado no reload após importar */ }

// ---------- modais ----------
const modalOpen = () => !$('#modal').hidden;
function openModal(html, bind) {
    $('#modal').hidden = false; const card = $('#modal-card'); card.innerHTML = html; hydrate(card);
    card.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
    bind?.(card);
}
function closeModal() { $('#modal').hidden = true; $('#modal-card').innerHTML = ''; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !$('#modal').dataset.locked) closeModal(); });
function confirmModal(title, text, ok, fn) { openModal(`<h2>${title}</h2><p class="note">${text}</p><div class="modal-actions"><button data-close>Cancelar</button><button class="primary" data-ok>${ok}</button></div>`, (c) => { c.querySelector('[data-ok]').onclick = () => { closeModal(); fn(); }; }); }

function openCreature(id) {
    const g = game.byId(id); if (!g) return;
    const st = statsOf(g, modsFor()), inTeam = S().team.includes(id), mv = movesOf(g);
    const next = xpToNext(g.level);
    openModal(`<div class="detail"><img src="${portrait({ ...g, id: g.id + ':big' }, 256)}" alt=""><div>
        <h2>${nameHtml(g)}</h2><div class="types">${g.types.map(typeTag).join('')}</div>
        <p class="note"><span class="rar" style="color:${rarity(g).color}">${rarity(g).name}</span> · ${BODY_INFO[g.body].name} · Geração ${g.gen}${g.mutated ? ' · Mutante' : ''}<br>Nível ${g.level} · XP ${fmt(g.xp)}/${fmt(next)}<br>Forma ${evoStage(g) + 1}/3 ${[0, 1, 2].map(k => k === evoStage(g) ? '<b>' + formName(g.body, g.types[0], k) + '</b>' : formName(g.body, g.types[0], k)).join(' → ')}${evoStage(g) < 2 ? ` · evolui no Nv ${EVO_LEVELS[evoStage(g)]}` : ''}</p>
        <div class="stats-grid"><div><b>${fmt(st.hp)}</b>Vida</div><div><b>${fmt(st.atk)}</b>Ataque</div><div><b>${fmt(st.def)}</b>Defesa</div><div><b>${fmt(st.spd)}</b>Veloc.</div></div>
        <div class="section-title">Potencial genético</div>
        <div class="bars">${['hp', 'atk', 'def', 'spd'].map(k => `<span>${{ hp: 'Vida', atk: 'Atq', def: 'Def', spd: 'Vel' }[k]}</span><div class="b"><i style="width:${g.pot[k] / 31 * 100}%"></i></div><span>${g.pot[k]}/31</span>`).join('')}</div>
        <div class="moves">${mv.map(m => `<div class="move"><span>${typeTag(m.type)} ${m.name}</span><span>Poder ${m.power} · ⚡${m.cost}</span></div>`).join('')}</div>
    </div></div>
    <div class="modal-actions">
        <button data-lock>${g.locked ? '🔓 Destravar' : '🔒 Travar'}</button>
        ${inTeam ? '' : `<button data-release ${g.locked ? 'disabled' : ''}>Libertar (+${fmt(game.dnaValue(g))} DNA)</button>`}
        <button data-view>Ver em 3D</button>
        <button class="primary" data-team ${!inTeam && S().team.length >= game.teamSize() ? 'disabled' : ''}>${inTeam ? 'Tirar da equipe' : 'Pôr na equipe'}</button>
    </div>`, (c) => {
        c.querySelector('[data-lock]').onclick = () => { g.locked = !g.locked; closeModal(); renderPanel(); };
        c.querySelector('[data-release]')?.addEventListener('click', () => { game.release(id); closeModal(); renderPanel(); });
        c.querySelector('[data-team]').onclick = () => { game.toggleTeam(id); ctx = null; closeModal(); renderPanel(); };
        c.querySelector('[data-view]').onclick = () => { closeModal(); if (view !== 'sanctuary' && !S().team.includes(id)) selectTab('sanctuary'); stage3d.focusOn(id); setTimeout(() => stage3d.focusOn(null), 6000); };
    });
}

function openStarter() {
    const opts = game.starterOptions(); for (const g of opts) ctxCreatures.set(g.id, g);
    $('#modal').dataset.locked = '1';
    openModal(`<h2>Escolha seu primeiro parceiro</h2><p class="note">Cada criatura da Fenda é única: gerada por um genoma que define corpo, cores, tipos e potencial. Esta é só a primeira de milhares.</p>
    <div class="starters">${opts.map((g, i) => `<div class="card" data-st="${i}">${imgFor(g)}<div class="n">${nameHtml(g)}</div><div class="types">${g.types.map(typeTag).join('')}</div><div class="m">${BODY_INFO[g.body].name}</div></div>`).join('')}</div>`, (c) => {
        c.querySelectorAll('[data-st]').forEach(el => el.onclick = () => { game.chooseStarter(Number(el.dataset.st)); delete $('#modal').dataset.locked; closeModal(); save(); startBattle(); tutorial(); });
    });
}
function tutorial() {
    openModal(`<h2>Bem-vindo à Fenda</h2><p class="note">• Suas criaturas lutam <b>sozinhas</b>, até offline: ao voltar, o jogo simula de verdade cada luta que aconteceu.<br>• Encha o anel <b>SYNC</b> causando dano e toque para a equipe toda agir de uma vez.<br>• Vitórias dão Essência e XP; inimigos derrotados podem ser <b>capturados</b> com orbes.<br>• Criaturas fora da equipe vivem no <b>Santuário</b> e produzem recursos.<br>• <b>Funda</b> genomas para criar criaturas novas, e entre na <b>Expedição</b> roguelike a partir do estágio 15.<br>• Quando travar, use o <b>Colapso</b>: recomeça mais forte com perks permanentes.</p><div class="modal-actions"><button class="primary" data-close>Vamos lá</button></div>`);
}
function openOfflineReport(sum) {
    const h = Math.floor(sum.seconds / 3600), m = Math.floor(sum.seconds / 60) % 60;
    openModal(`<h2>Enquanto você estava fora…</h2><p class="note">${h ? h + ' h ' : ''}${m} min simulados luta a luta (limite de ${Math.round(game.offlineCapSeconds() / 3600)} h).</p>
    <div class="report"><div><b>${fmt(sum.battles)}</b><small>batalhas · ${fmt(sum.wins)} vitórias</small></div><div><b>${sum.stageFrom} → ${sum.stageTo}</b><small>estágio</small></div>
    <div><b>◆ ${fmt(sum.essence)}</b><small>Essência</small></div><div><b>⧉ ${fmt(sum.dna)}</b><small>DNA</small></div>
    <div><b>+${sum.levels}</b><small>níveis na equipe</small></div><div><b>${sum.captures}</b><small>capturas${sum.prismatics ? ' · ' + sum.prismatics + ' prismática(s)!' : ''}</small></div></div>
    <div class="modal-actions"><button class="primary" data-close>Coletar</button></div>`);
}
function openRelicChoice() {
    const ex = S().expedition; if (!ex || !ex.choices) return;
    $('#modal').dataset.locked = '1';
    openModal(`<h2>Andar ${ex.floor} vencido!</h2><p class="note">Escolha uma relíquia. Elas se acumulam até o fim da expedição.</p>
    ${ex.choices.map(id => { const r = RELICS.find(x => x.id === id), n = ex.relics[id] || 0; return `<div class="row"><div><h4>${r.name}${n ? ' <span class="lv">×' + n + ' → ×' + (n + 1) + '</span>' : ''}</h4><p>${r.desc}</p></div><button class="primary" data-relic="${id}">Pegar</button></div>`; }).join('')}
    <div class="modal-actions"><button data-quit>Sair com o saque</button></div>`, (c) => {
        c.querySelectorAll('[data-relic]').forEach(b => b.onclick = () => { game.pickRelic(b.dataset.relic); delete $('#modal').dataset.locked; closeModal(); ctx = null; startBattle(); renderPanel(); });
        c.querySelector('[data-quit]').onclick = () => { delete $('#modal').dataset.locked; closeModal(); game.endExpedition(false); ctx = null; };
    });
}
function openExpeditionEnd(d) {
    if (d.egg) ctxCreatures.set(d.egg.id, d.egg);
    setTimeout(() => openModal(`<h2>${d.victory ? 'A Fenda foi vencida!' : 'Fim da expedição'}</h2><p class="note">Andares vencidos: ${d.reached}/${EXPEDITION_FLOORS}</p>
    <div class="report"><div><b>◆ ${fmt(d.essence)}</b><small>Essência</small></div><div><b>⧉ ${fmt(d.dna)}</b><small>DNA</small></div></div>
    ${d.egg ? `<div class="row" style="margin-top:10px"><div style="width:90px">${imgFor(d.egg)}</div><div style="flex:1"><h4>Ovo da Fenda: ${nameHtml(d.egg)}</h4><p><span class="rar" style="color:${rarity(d.egg).color}">${rarity(d.egg).name}</span> · ${d.egg.types.map(typeTag).join(' ')}</p></div></div>` : '<p class="note">Chegue ao andar 3 para ganhar um Ovo da Fenda.</p>'}
    <div class="modal-actions"><button class="primary" data-close>Continuar</button></div>`), 300);
    ctx = null;
}
function fuseAnimation() {
    const [a, b] = labPick; const child = game.fuse(a, b); labPick = [];
    if (!child) return;
    openModal(`<h2>Fusão concluída</h2><div class="detail"><img src="${portrait({ ...child, id: child.id + ':big' }, 256)}" alt=""><div><h2>${nameHtml(child)}</h2><div class="types">${child.types.map(typeTag).join('')}</div><p class="note"><span class="rar" style="color:${rarity(child).color}">${rarity(child).name}</span> · Geração ${child.gen}${child.mutated ? ' · <b>MUTANTE</b>' : ''}</p><div class="bars">${['hp', 'atk', 'def', 'spd'].map(k => `<span>${k.toUpperCase()}</span><div class="b"><i style="width:${child.pot[k] / 31 * 100}%"></i></div><span>${child.pot[k]}</span>`).join('')}</div></div></div><div class="modal-actions"><button class="primary" data-close>Incrível</button></div>`);
    renderPanel();
}

// ---------- início ----------
addEventListener('pointerdown', () => { unlockAudio(); setSound(S().settings.sound); }, { once: false, passive: true });
function boot() {
    const s = S();
    const away = (Date.now() - s.lastTick) / 1000;
    if (s.starterChosen && away > 60) runOfflineGap(away, true);
    s.lastTick = Date.now();
    stage3d.setIsland(game.zoneOf(s.stage).type, s.seed + ':z' + Math.floor((s.stage - 1) / ZONE_LEN));
    setTimeout(() => $('#boot').classList.add('gone'), 400);
    if (!s.starterChosen) openStarter(); else startBattle();
    updateHud();
    lastFrame = performance.now();
    requestAnimationFrame(frame);
}
window.__rift = { get game() { return game; }, stage3d, get ctx() { return ctx; }, selectTab, save };
boot();
