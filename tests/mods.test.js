import test from 'node:test';
import assert from 'node:assert/strict';
import { GRADES, PART_SLOTS, MOD_WEAPONS, canMount, seededRng, rollGrade, rollItem, designOf, nameOf, createModStore } from '../src/game/mods.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('개조 뽑기: 등급 확률은 일반 60·희귀 25·레어 11·엘리트 4(%)', () => {
  assert.deepEqual(GRADES.map((g) => [g.name, g.weight]), [['일반', 60], ['희귀', 25], ['레어', 11], ['엘리트', 4]]);
  const rng = seededRng(42);
  const n = 20000, count = {};
  for (let i = 0; i < n; i++) { const g = rollGrade(rng); count[g] = (count[g] ?? 0) + 1; }
  for (const g of GRADES) assert.ok(Math.abs(count[g.id] / n * 100 - g.weight) < 1.5, `${g.name} ${count[g.id] / n * 100}%`);
});

test('개조 파츠: 칸 5종, 같은 seed면 같은 디자인·이름, 다른 seed면 새 디자인', () => {
  assert.deepEqual(PART_SLOTS.map((s) => s.name), ['개머리판', '총구', '스코프', '탄창', '총 색깔']);
  const a = rollItem(seededRng(7)), b = rollItem(seededRng(7)), c = rollItem(seededRng(8));
  assert.deepEqual(a, b);
  assert.deepEqual(designOf(a), designOf(b));
  assert.equal(nameOf(a), a.name);
  assert.ok(a.name.length > 3);
  assert.notEqual(a.seed, c.seed);
  // 엘리트는 빛나는 장식, 일반은 없음
  for (const slot of PART_SLOTS) {
    assert.ok(designOf({ slot: slot.id, grade: 'elite', seed: 1 }).glow);
    assert.equal(designOf({ slot: slot.id, grade: 'common', seed: 1 }).glow, null);
  }
});

test('개조 배낭: 뽑으면 배낭에 저장되고, 총마다 붙일 수 있는 칸만 장착, 분해하면 장착도 풀림, 다시 열어도 그대로', () => {
  const storage = memory();
  const store = createModStore(storage);
  assert.deepEqual(store.draw(1, seededRng(3)), [], '코인이 없으면 못 뽑음');
  store.addCoins(11);
  const got = store.draw(10, seededRng(3));
  assert.equal(store.coins, 1, '1번에 1코인');
  assert.equal(got.length, 10);
  assert.equal(store.items.length, 10);
  assert.equal(store.draws, 10);
  const scope = { id: 999, ...rollItem(seededRng(5), 'scope') };
  store.items.push(scope);
  const stock = store.draw(1, seededRng(11))[0];
  const stockItem = { ...stock, slot: 'stock' };
  Object.assign(stock, stockItem);
  assert.ok(store.equip('rifle', scope.id));
  assert.equal(store.equipped('rifle').scope.id, scope.id);
  assert.ok(!canMount('pistol', 'stock'));
  assert.equal(store.equip('pistol', stock.id), false, '권총엔 개머리판 없음');
  assert.ok(store.equip('rpg', scope.id), '같은 파츠를 여러 총에');
  assert.ok(store.isEquipped('rpg', scope.id));
  const sig = store.signature('rifle');
  assert.ok(sig.includes('scope:'));
  store.unequip('rifle', 'scope');
  assert.equal(store.equipped('rifle').scope, undefined);
  store.equip('rifle', scope.id);
  store.remove(scope.id);
  assert.equal(store.equipped('rifle').scope, undefined, '분해하면 떨어짐');
  assert.equal(store.equipped('rpg').scope, undefined);
  const again = createModStore(storage);
  assert.equal(again.items.length, store.items.length, '저장한 배낭을 다시 읽음');
  assert.equal(again.draws, 11);
  assert.equal(again.coins, 0, '코인도 저장');
  assert.ok(Object.keys(MOD_WEAPONS).every((w) => MOD_WEAPONS[w].includes('skin')), '모든 총은 색깔을 바꿀 수 있음');
});

test('개조 배낭: 깨진 저장은 버리고 빈 배낭으로 시작', () => {
  const storage = memory();
  storage.setItem('haha2.mods.v1', '{oops');
  assert.equal(createModStore(storage).items.length, 0);
  storage.setItem('haha2.mods.v1', JSON.stringify({ items: [{ id: 1, slot: 'nope', grade: 'common', seed: 1 }, { id: 2, slot: 'mag', grade: 'rare', seed: 5 }] }));
  const s = createModStore(storage);
  assert.equal(s.items.length, 1);
  assert.ok(s.items[0].name);
});
