// Mapa de Caça: exploração em 3D + batalha clássica por turnos contra criaturas selvagens.
// A progressão idle (estágios) continua rodando em segundo plano enquanto você caça.
import { Overworld } from './render/overworld.js';
import { startWild, act, activeUnit, captureChance } from './wild.js';
import { createGenome, displayName, RARITIES, RARITY_INDEX, addXp, evoStage } from './genome.js';
import { TYPES, TYPE_INFO } from './data.js';
import { ZONES, ZONE_LEN } from './game.js';
import { makeRng } from './rng.js';

const $ = (s, r = document) => r.querySelector(s);

export function createHunt(api) {
    const { game, stage3d, sfx, toast, log, imgFor, nameHtml, typeTag, esc, fmt, hydrate } = api;
    const S = () => game().s;
    let ow = null, owKey = '', zoneIdx = 0, hp = {}, wild = null, busy = false, spawnN = 0;

    const unlockedZones = () => Math.min(ZONES.length - 1, Math.floor((S().maxStageEver - 1) / ZONE_LEN));
    const zoneLevel = (z) => game().enemyLevel(Math.min(S().maxStageEver, z * ZONE_LEN + 12));

    function makeWild({ alpha = false } = {}) {
        const z = ZONES[zoneIdx], r = makeRng(S().seed + ':w:' + (spawnN++) + ':' + Date.now());
        const type = r() < 0.65 ? z.type : r() < 0.35 ? game().tide().type : r.pick(TYPES);
        const lv = Math.max(2, zoneLevel(zoneIdx) + r.int(-3, 2) + (alpha ? 6 : 0));
        const g = createGenome(S().seed + ':wild:' + spawnN + ':' + r(), { type, level: lv, luck: 0.3 + zoneIdx * 0.3 + (alpha ? 3 : 0), prismaticRate: game().prismaticRate() * 2, rarity: alpha ? RARITIES[Math.min(4, 2 + r.int(0, 2))].id : undefined });
        g.level = lv; if (alpha) g.alpha = true;
        return g;
    }

    function enter() {
        zoneIdx = Math.min(zoneIdx, unlockedZones());
        const key = zoneIdx + ':' + S().seed;
        if (!ow || owKey !== key) {
            ow?.dispose();
            ow = new Overworld(stage3d, { zoneType: ZONES[zoneIdx].type, seed: S().seed + ':zone' + zoneIdx, makeWild, onEncounter, onItem, onHeal });
            owKey = key;
        }
        ow.paused = false; ow.cool = 1.5;
        stage3d.setExternal(ow);
        $('#hunt-hud').hidden = false; $('#joy').hidden = !matchMedia('(pointer: coarse)').matches;
        renderHud();
    }
    function leave() {
        $('#hunt-hud').hidden = true; $('#joy').hidden = true; $('#wild-ui').hidden = true;
        if (wild) endWild('run', true);
        stage3d.setExternal(null);
        if (ow) ow.keys.clear();
    }
    function renderHud() {
        const team = game().teamGenomes(), z = ZONES[zoneIdx];
        $('#hunt-hud').innerHTML = `<div class="hz"><button data-z="-1" ${zoneIdx <= 0 ? 'disabled' : ''} aria-label="Zona anterior">◀</button><div><small>Mapa de Caça · Nv ~${zoneLevel(zoneIdx)}</small><b style="color:${TYPE_INFO[z.type].color}">${z.name}</b></div><button data-z="1" ${zoneIdx >= unlockedZones() ? 'disabled' : ''} aria-label="Próxima zona">▶</button></div>
        <div class="hteam">${team.map(g => { const f = hp[g.id] ?? 1; return `<span title="${esc(displayName(g))}"><i style="width:${f * 100}%;background:${f > 0.5 ? 'var(--good)' : f > 0.2 ? 'var(--gold)' : 'var(--bad)'}"></i>${esc(displayName(g)).slice(0, 8)}</span>`; }).join('')}<span class="horbs">● ${fmt(S().orbs)}</span></div>
        <div class="hhint">${matchMedia('(pointer: coarse)').matches ? 'Joystick ou toque no chão para andar' : 'WASD/setas para andar · Shift corre · Q/E giram a câmera · clique no chão'} · mato alto = encontros · cristal rosa cura</div>`;
        $('#hunt-hud').querySelectorAll('[data-z]').forEach(b => b.onclick = () => { zoneIdx = Math.max(0, Math.min(unlockedZones(), zoneIdx + Number(b.dataset.z))); enter(); });
    }

    function onItem(kind) {
        const g = game();
        if (kind === 'orbs') { S().orbs += 3; toast('<div style="font-size:26px;padding:4px 8px">●</div><div><b>+3 Orbes</b><small>encontrados no mato</small></div>'); }
        if (kind === 'essence') { const v = g.essencePerWin(Math.max(1, S().maxStage)) * 3; S().essence += v; toast(`<div style="font-size:26px;padding:4px 8px;color:#7af7ff">◆</div><div><b>+${fmt(v)} Essência</b><small>cristal de essência</small></div>`); }
        if (kind === 'dna') { S().dna += 12; toast('<div style="font-size:26px;padding:4px 8px;color:#6dffa8">⧉</div><div><b>+12 DNA</b><small>fragmento genético</small></div>'); }
        sfx('buy'); renderHud();
    }
    function onHeal() {
        if (!Object.keys(hp).length) return;
        hp = {}; sfx('evolve'); toast('<div style="font-size:26px;padding:4px 8px;color:#ff4fd8">✚</div><div><b>Equipe curada!</b><small>O cristal restaurou toda a vida.</small></div>'); renderHud();
    }

    // ---------- batalha selvagem ----------
    let roamer = null, queue = [];
    function onEncounter(g, r) {
        if (wild || busy || !game().teamGenomes().some(t => (hp[t.id] ?? 1) > 0)) { if (!wild && !busy) toast('<div style="font-size:26px;padding:4px 8px">✚</div><div><b>Equipe sem forças</b><small>Vá ao cristal rosa no centro do mapa para curar.</small></div>'); return; }
        roamer = r; ow.paused = true; busy = true; sfx('ult');
        game().markSeen(g);
        const fl = $('#flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
        setTimeout(() => {
            const team = game().teamGenomes();
            wild = startWild(team, g, { seed: (Date.now() ^ spawnN) >>> 0, hp, mods: (() => { const m = game().playerMods(); return { atk: m.dmg, hp: m.hp, spd: m.spd }; })(), orbs: S().orbs, tide: game().tide().type, orbBonus: 1 + game().perk('catcher') * 0.1 });
            stage3d.setExternal(null);
            stage3d.setIsland(ZONES[zoneIdx].type, S().seed + ':huntarena' + zoneIdx);
            showMeshes();
            $('#hunt-hud').hidden = true; $('#joy').hidden = true; $('#wild-ui').hidden = false;
            renderWild();
            say([`${g.alpha ? 'Um ALFA ' : g.prismatic ? '✦ Um PRISMÁTICO ' : 'Um '}${displayName(g)} selvagem apareceu!`, `Vai, ${displayName(activeUnit(wild).g)}!`], () => { busy = false; menu(); });
            if (g.prismatic) sfx('prism');
        }, 550);
    }
    function showMeshes() { stage3d.showBattle([activeUnit(wild).g], [wild.foe.g], { duel: true }); }
    function hpBar(u, mine) {
        const f = u.hp / u.maxHp, col = f > 0.5 ? 'var(--good)' : f > 0.2 ? 'var(--gold)' : 'var(--bad)';
        const st = u.status ? `<span class="wst">${{ burn: 'QUE', poison: 'ENV', stun: 'PAR' }[u.status]}</span>` : '';
        return `<div class="wname">${nameHtml(u.g)} ${st}<em>Nv${u.g.level}</em></div><div class="wtypes">${u.g.types.map(typeTag).join('')} <span class="rar" style="color:${RARITIES[RARITY_INDEX[u.g.rarity]].color}">${RARITIES[RARITY_INDEX[u.g.rarity]].name}${u.g.alpha ? ' · ALFA' : ''}</span></div><div class="whp"><span>HP</span><div><i style="width:${f * 100}%;background:${col}"></i></div></div>${mine ? `<div class="whpn">${fmt(u.hp)} / ${fmt(u.maxHp)}</div>` : ''}`;
    }
    function renderWild() {
        if (!wild) return;
        $('#wfoe').innerHTML = hpBar(wild.foe, false);
        $('#wme').innerHTML = hpBar(activeUnit(wild), true);
    }
    function say(lines, done) {
        const box = $('#wtext'); $('#wmenu').innerHTML = '';
        const next = () => { if (!lines.length) return done?.(); box.textContent = lines.shift(); setTimeout(next, 850); };
        next();
    }
    function menu() {
        if (!wild || wild.over) return;
        const u = activeUnit(wild);
        $('#wtext').textContent = `O que ${displayName(u.g)} vai fazer?`;
        $('#wmenu').innerHTML = `<button data-m="fight" class="wb fight">LUTAR</button><button data-m="orb" class="wb orb">ORBE <small>${fmt(wild.orbs)} · ${Math.round(captureChance(wild) * 100)}%</small></button><button data-m="party" class="wb party">TROCAR</button><button data-m="run" class="wb run">FUGIR</button>`;
        $('#wmenu').querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
            sfx('ui');
            if (b.dataset.m === 'fight') return moves();
            if (b.dataset.m === 'party') return party();
            run(b.dataset.m === 'orb' ? { type: 'orb' } : { type: 'run' });
        });
    }
    function moves() {
        const u = activeUnit(wild);
        $('#wmenu').innerHTML = u.moves.map((m, i) => { const eff = wild.foe.g.types.reduce((a, t) => a * (TYPE_INFO[m.type] ? 1 : 1), 1); void eff; return `<button data-i="${i}" class="wb mv" style="--tc:${TYPE_INFO[m.type].color}" ${m.pp <= 0 ? 'disabled' : ''}><b>${m.name}</b><small>${TYPE_INFO[m.type].name} · Poder ${m.power} · PP ${m.pp === Infinity ? '∞' : m.pp + '/' + m.maxPp}</small></button>`; }).join('') + '<button data-back class="wb">VOLTAR</button>';
        $('#wmenu').querySelectorAll('[data-i]').forEach(b => b.onclick = () => run({ type: 'move', i: Number(b.dataset.i) }));
        $('#wmenu [data-back]').onclick = menu;
    }
    function party() {
        $('#wmenu').innerHTML = wild.mine.map((u, i) => `<button data-p="${i}" class="wb" ${u.hp <= 0 || i === wild.active ? 'disabled' : ''}><b>${esc(displayName(u.g))}</b><small>Nv${u.g.level} · HP ${fmt(u.hp)}/${fmt(u.maxHp)}</small></button>`).join('') + '<button data-back class="wb">VOLTAR</button>';
        $('#wmenu').querySelectorAll('[data-p]').forEach(b => b.onclick = () => run({ type: 'switch', i: Number(b.dataset.p) }));
        $('#wmenu [data-back]').onclick = menu;
    }
    function run(action) {
        if (busy || !wild) return;
        busy = true; $('#wmenu').innerHTML = '';
        const meId = activeUnit(wild).g.id;
        const steps = act(wild, action);
        S().orbs = wild.orbs;
        play(steps, meId, () => { busy = false; if (wild && wild.over) finish(); else { renderWild(); menu(); } });
    }
    function play(steps, meId, done) {
        if (!steps.length) return done();
        const s = steps.shift(), box = $('#wtext'), next = (ms = 850) => setTimeout(() => play(steps, activeUnit(wild).g.id, done), ms);
        if (s.msg) box.textContent = s.msg;
        const foeId = wild.foe.g.id;
        switch (s.t) {
            case 'hit': {
                const src = s.side === 'me' ? meId : foeId, dst = s.side === 'me' ? foeId : meId;
                stage3d.playEvents([{ t: 'hit', src, dst, dmg: s.dmg, eff: s.eff, crit: s.crit, mtype: s.mtype, tier: s.tier }]);
                setTimeout(renderWild, 420); sfx(s.tier === 'ult' ? 'ult' : s.crit ? 'crit' : s.eff > 1 ? 'super' : 'hit');
                return next(700);
            }
            case 'miss': stage3d.playEvents([{ t: 'miss', src: s.side === 'me' ? meId : foeId, dst: s.side === 'me' ? foeId : meId, mtype: 'gale', tier: 'strike' }]); return next();
            case 'dot': renderWild(); return next();
            case 'status': renderWild(); return next();
            case 'faint': stage3d.playEvents([{ t: 'faint', dst: s.side === 'me' ? meId : foeId }]); sfx('faint'); renderWild(); return next(1100);
            case 'recall': return next(500);
            case 'switch': showMeshes(); renderWild(); return next(900);
            case 'throw': sfx('ui'); stage3d.orbThrow(meId, foeId, () => play(steps, meId, done)); return;
            case 'shake': sfx('hit', { pitch: 0.5 }); stage3d.orbShake(() => setTimeout(() => play(steps, meId, done), 250)); return;
            case 'caught': sfx('capture'); stage3d.orbResult(foeId, true, () => play(steps, meId, done)); return;
            case 'breakfree': stage3d.orbResult(foeId, false, () => next(500)); return;
            default: return next();
        }
    }
    function finish() {
        const st = wild, g = game(), lines = [];
        if (st.over === 'win') {
            const me = activeUnit(st), xp = Math.ceil(g.xpPerWin(Math.max(1, Math.round(st.foe.g.level / 1.05))) * (st.foe.g.alpha ? 3 : 1.5));
            const ess = Math.ceil(g.essencePerWin(Math.max(1, Math.min(S().maxStage, Math.round(st.foe.g.level)))) * 0.6);
            const evo0 = evoStage(me.g), lv0 = me.g.level;
            addXp(me.g, xp); for (const u of st.mine) if (u !== me && u.hp > 0) addXp(u.g, Math.ceil(xp * 0.3));
            for (const u of st.mine) delete u.g.evolved;
            S().essence += ess; S().stats.wins++;
            lines.push(`${displayName(me.g)} ganhou ${fmt(xp)} de XP! +${fmt(ess)} Essência`);
            if (me.g.level > lv0) lines.push(`${displayName(me.g)} subiu para o nível ${me.g.level}!`);
            if (evoStage(me.g) > evo0) { lines.push(`O quê? ${me.g.name} está evoluindo… virou ${displayName(me.g)}!`); sfx('evolve'); }
        } else if (st.over === 'caught') {
            const c = JSON.parse(JSON.stringify(st.foe.g)); c.id = 'h' + Date.now().toString(36) + spawnN.toString(36); delete c.alpha; c.xp = 0;
            const isNew = g.addCreature(c, true);
            S().stats.captures++; if (c.prismatic) S().stats.prismatics++;
            lines.push(isNew ? `${displayName(c)} foi registrado no Genodex!` : `${displayName(c)} foi enviado ao Santuário.`);
            toast(`${imgFor(c)}<div><b>${nameHtml(c)} capturado!</b><small>${RARITIES[RARITY_INDEX[c.rarity]].name} · Nv${c.level}${isNew ? ' · NOVA ESPÉCIE' : ''}</small></div>`, c.prismatic ? 'prism' : '');
        }
        for (const u of st.mine) hp[u.g.id] = u.hp / u.maxHp;
        if (st.over === 'lose') hp = {};
        const outcome = st.over;
        say(lines, () => endWild(outcome));
    }
    function endWild(outcome, silent = false) {
        const r = roamer; roamer = null;
        if ((outcome === 'win' || outcome === 'caught') && r && ow) ow.removeRoamer(r.g);
        wild = null; busy = false; $('#wild-ui').hidden = true;
        if (silent) return;
        api.onWildEnd?.();
        stage3d.setExternal(ow); ow.paused = false; ow.cool = 2.5;
        if (outcome === 'lose' && ow) { ow.player.position.set(0, ow.heightAt(0, 3), 3); }
        $('#hunt-hud').hidden = false; $('#joy').hidden = !matchMedia('(pointer: coarse)').matches; renderHud();
        hydrate(document.body);
    }

    // ---------- controles ----------
    addEventListener('keydown', (e) => {
        if (!ow || stage3d.external !== ow || e.target.closest?.('input,textarea')) return;
        const k = e.key.toLowerCase(); ow.keys.add(k);
        if (k === 'q') ow.camYaw += 0.3; if (k === 'e') ow.camYaw -= 0.3;
        if (k.startsWith('arrow') || k === ' ') e.preventDefault();
    });
    addEventListener('keyup', (e) => ow?.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => ow?.keys.clear());
    $('#stage').addEventListener('pointerdown', (e) => { if (ow && stage3d.external === ow && !ow.paused) ow.tap(e.clientX, e.clientY); });
    $('#stage').addEventListener('wheel', (e) => { if (ow && stage3d.external === ow) ow.camDist = Math.max(6, Math.min(20, ow.camDist + Math.sign(e.deltaY))); }, { passive: true });
    const joy = $('#joy'), knob = joy.querySelector('i'); let jid = null;
    const jmove = (e) => { const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } knob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`; if (ow) ow.input = { x: dx, y: -dy }; };
    joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); jmove(e); e.stopPropagation(); });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) jmove(e); });
    const jend = () => { jid = null; knob.style.transform = ''; if (ow) ow.input = { x: 0, y: 0 }; };
    joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);

    return { enter, leave, active: () => !!ow && stage3d.external === ow, inBattle: () => !!wild, get ow() { return ow; }, refresh: renderHud };
}
