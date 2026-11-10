import test from 'node:test';
import assert from 'node:assert/strict';
import { GRADES, PART_SLOTS, MOD_WEAPONS, canMount, seededRng, rollGrade, rollItem, designOf, nameOf, createModStore, SHOP, SHOP_BY_ID, SHOP_PRICE } from '../src/game/mods.js';

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

test('상점: 레어 30·엘리트 30 총기 스킨 60가지, 이름이 모두 다르고 그 총에 붙는 칸을 한 벌로 갖춤', () => {
  assert.equal(SHOP.length, 60);
  assert.equal(SHOP.filter((g) => g.grade === 'rare').length, 30);
  assert.equal(SHOP.filter((g) => g.grade === 'elite').length, 30);
  assert.equal(new Set(SHOP.map((g) => g.name)).size, 60);
  assert.equal(new Set(SHOP.map((g) => g.id)).size, 60);
  assert.deepEqual(SHOP_PRICE, { rare: 3, elite: 8 });
  for (const g of SHOP) {
    assert.equal(g.price, SHOP_PRICE[g.grade]);
    assert.deepEqual(g.parts.map((p) => p.slot), MOD_WEAPONS[g.weapon]);
    assert.ok(g.parts.every((p) => p.grade === g.grade && Number.isFinite(p.seed)));
  }
  assert.deepEqual(new Set(SHOP.map((g) => g.weapon)), new Set(Object.keys(MOD_WEAPONS)), '8가지 총에 골고루');
});

test('상점 구매: 코인을 내고 파츠 한 벌을 받아 바로 장착, 다시 열어도 보관, 분해 불가, 다시 장착 가능', () => {
  const storage = memory();
  const store = createModStore(storage);
  const rare = SHOP.find((g) => g.grade === 'rare'), elite = SHOP.find((g) => g.grade === 'elite');
  assert.deepEqual(store.buy(rare.id), [], '코인이 없으면 못 삼');
  store.addCoins(10);
  const got = store.buy(rare.id);
  assert.equal(got.length, rare.parts.length);
  assert.equal(store.coins, 7);
  assert.ok(store.owns(rare.id) && store.shopEquipped(rare.id));
  assert.deepEqual(store.buy(rare.id), [], '같은 총기는 한 번만');
  assert.equal(store.canBuy(elite.id), false, '7코인으로는 엘리트(8코인)를 못 삼');
  store.addCoins(1);
  assert.equal(store.buy(elite.id).length, elite.parts.length);
  assert.equal(store.coins, 0);
  // 분해해도 그대로(영구 보관), 장착을 풀었다가 다시 한 번에 장착
  store.remove(got[0].id);
  assert.ok(store.items.some((i) => i.id === got[0].id));
  store.unequip(rare.weapon, got[0].slot);
  assert.equal(store.shopEquipped(rare.id), false);
  assert.ok(store.equipShop(rare.id));
  assert.ok(store.shopEquipped(rare.id));
  // 다시 열어도(다음 접속) 산 총기·파츠·장착이 남음
  const again = createModStore(storage);
  assert.deepEqual(again.owned, [rare.id, elite.id]);
  assert.ok(again.shopEquipped(rare.id));
  assert.equal(again.items.filter((i) => i.shop).length, rare.parts.length + elite.parts.length);
  assert.equal(SHOP_BY_ID[rare.id], rare);
});
