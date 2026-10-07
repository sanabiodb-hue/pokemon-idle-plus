// ============================================================
// PC / 箱子（PC Storage）- 不在队伍里的个体存放处
//
// 数据：state.pc = { boxes: [ { id, name, capacity, slots: [uid|null, ...] }, ... ] }
//   - 每个箱子是固定长度的格子数组，空格为 null，所以“放在第几格”是有意义的（将来可以拖拽排序）。
//   - 支持多个箱子；存满时自动新建箱子，直到 PC_MAX_BOXES。
// 只负责存取位置，不创建/删除个体（那是 PokemonRoster 的工作）。
// ============================================================
const PC_BOX_CAPACITY = 30;
const PC_MAX_BOXES = 200;
const PC_BOX_NAME_MAX = 16;

// 箱子名：只保留安全字符，空则回退为“箱子 N”
function sanitizeBoxName(value, index) {
    const cleaned = (typeof value === 'string' ? value : '')
        .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
        .replace(/[<>"'`&\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const name = Array.from(cleaned).slice(0, PC_BOX_NAME_MAX).join('').trim();
    return name || `箱子 ${index + 1}`;
}

class PCStorage {
    constructor(getState) {
        this._getState = getState;
        this._hintBox = 0; // 第一个可能还有空位的箱子，避免每次都从头扫
    }

    get state() { return this._getState(); }

    // ---------- 静态：构造数据（迁移/读档/测试使用）----------
    static createBox(id, name, capacity = PC_BOX_CAPACITY) {
        return { id, name, capacity, slots: new Array(capacity).fill(null) };
    }

    static createEmpty() {
        return { boxes: [PCStorage.createBox(1, sanitizeBoxName('', 0))] };
    }

    // 按顺序把 uid 列表铺进箱子（不足则新建）。返回 { pc, overflow:[uid...] }
    static layout(uids) {
        const pc = { boxes: [] };
        const overflow = [];
        let box = null;
        let slot = 0;
        for (const uid of uids) {
            if (!box || slot >= box.capacity) {
                if (pc.boxes.length >= PC_MAX_BOXES) { overflow.push(uid); continue; }
                box = PCStorage.createBox(pc.boxes.length + 1, sanitizeBoxName('', pc.boxes.length));
                pc.boxes.push(box);
                slot = 0;
            }
            box.slots[slot++] = uid;
        }
        if (pc.boxes.length === 0) pc.boxes.push(PCStorage.createBox(1, sanitizeBoxName('', 0)));
        return { pc, overflow };
    }

    // ---------- 查询 ----------
    boxes() { return this.state.pc.boxes; }
    boxCount() { return this.state.pc.boxes.length; }

    totalCapacity() {
        return this.state.pc.boxes.reduce((s, b) => s + b.capacity, 0);
    }

    count() {
        let n = 0;
        for (const b of this.state.pc.boxes) for (const u of b.slots) if (u !== null) n++;
        return n;
    }

    uids() {
        const out = [];
        for (const b of this.state.pc.boxes) for (const u of b.slots) if (u !== null) out.push(u);
        return out;
    }

    find(uid) {
        const boxes = this.state.pc.boxes;
        for (let b = 0; b < boxes.length; b++) {
            const slot = boxes[b].slots.indexOf(uid);
            if (slot !== -1) return { box: b, slot };
        }
        return null;
    }

    contains(uid) { return this.find(uid) !== null; }

    boxContents(boxIndex) {
        const box = this.state.pc.boxes[boxIndex];
        return box ? box.slots.slice() : null;
    }

    // ---------- 修改 ----------
    addBox(name) {
        const boxes = this.state.pc.boxes;
        if (boxes.length >= PC_MAX_BOXES) return { ok: false, code: 'max_boxes' };
        const nextId = boxes.reduce((m, b) => Math.max(m, b.id), 0) + 1;
        boxes.push(PCStorage.createBox(nextId, sanitizeBoxName(name, boxes.length)));
        return { ok: true, box: boxes.length - 1 };
    }

    renameBox(boxIndex, name) {
        const box = this.state.pc.boxes[boxIndex];
        if (!box) return { ok: false, code: 'bad_box' };
        box.name = sanitizeBoxName(name, boxIndex);
        return { ok: true };
    }

    // 放入一只：默认放到第一个空格（必要时新建箱子）；也可指定 { box, slot }
    deposit(uid, target) {
        const st = this.state;
        if (!ownedLookup(st.ownedPokemon, uid)) return { ok: false, code: 'unknown_pokemon' };
        if (this.contains(uid)) return { ok: false, code: 'already_in_pc' };
        if (st.party.includes(uid)) return { ok: false, code: 'in_party' };

        if (target) {
            const box = st.pc.boxes[target.box];
            if (!box || !Number.isInteger(target.slot) || target.slot < 0 || target.slot >= box.capacity) {
                return { ok: false, code: 'bad_slot' };
            }
            if (box.slots[target.slot] !== null) return { ok: false, code: 'slot_occupied' };
            box.slots[target.slot] = uid;
            return { ok: true, box: target.box, slot: target.slot };
        }

        const boxes = st.pc.boxes;
        for (let b = Math.min(this._hintBox, boxes.length - 1); b < boxes.length; b++) {
            const slot = boxes[b].slots.indexOf(null);
            if (slot !== -1) {
                boxes[b].slots[slot] = uid;
                this._hintBox = b;
                return { ok: true, box: b, slot };
            }
        }
        const added = this.addBox();
        if (!added.ok) return { ok: false, code: 'pc_full' };
        boxes[added.box].slots[0] = uid;
        this._hintBox = added.box;
        return { ok: true, box: added.box, slot: 0 };
    }

    // 取出（从箱子里拿走，调用方决定放到哪里）
    withdraw(uid) {
        const pos = this.find(uid);
        if (!pos) return { ok: false, code: 'not_in_pc' };
        this.state.pc.boxes[pos.box].slots[pos.slot] = null;
        if (pos.box < this._hintBox) this._hintBox = pos.box;
        return { ok: true, box: pos.box, slot: pos.slot };
    }

    // 在 PC 内移动；目标格有人则互换
    move(uid, boxIndex, slot) {
        const from = this.find(uid);
        if (!from) return { ok: false, code: 'not_in_pc' };
        const box = this.state.pc.boxes[boxIndex];
        if (!box || !Number.isInteger(slot) || slot < 0 || slot >= box.capacity) return { ok: false, code: 'bad_slot' };
        const other = box.slots[slot];
        this.state.pc.boxes[from.box].slots[from.slot] = other;
        box.slots[slot] = uid;
        return { ok: true, swapped: other };
    }
}
