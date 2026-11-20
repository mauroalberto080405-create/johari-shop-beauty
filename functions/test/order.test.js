import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrderError, buildOrder, normalizeItems, stockAfterSale, validateCustomer } from '../src/order.js';

const products = new Map([
  ['labial', { name: 'Tinta labial', brand: 'Fenty Beauty', price: 90, stock: 5, variants: [] }],
  ['agotado', { name: 'Rubor', brand: 'SHEGLAM', price: 62, stock: 0, variants: [] }],
  ['sin-stock', { name: 'Blush', brand: 'e.l.f.', price: 40, stock: null, variants: [] }],
  ['sin-precio', { name: 'Liquid Blush', brand: 'Rare Beauty', price: null, stock: 3, variants: [] }],
  ['pines', {
    name: 'Pines para Crocs', brand: '', price: 4, stock: null,
    variants: [
      { id: 'u1', name: '1 unidad', price: 4, stock: 10 },
      { id: 'u8', name: '8 unidades', price: 24, stock: 2 },
      { id: 'u16', name: '16 unidades', price: null, stock: 0 }
    ]
  }]
]);

const customer = {
  fullName: 'Lucía Pérez', phone: '+51 987 654 321', email: 'Lucia@Example.com',
  district: 'Miraflores', province: 'Lima', address: 'Av. Larco 123'
};

describe('normalizeItems', () => {
  it('agrupa ítems repetidos', () => {
    const items = normalizeItems([
      { productId: 'labial', variantId: null, qty: 1 },
      { productId: 'labial', variantId: null, qty: 2 }
    ]);
    assert.deepEqual(items, [{ productId: 'labial', variantId: null, qty: 3 }]);
  });

  it('rechaza carrito vacío y cantidades no enteras o negativas', () => {
    assert.throws(() => normalizeItems([]), OrderError);
    assert.throws(() => normalizeItems([{ productId: 'labial', qty: 1.5 }]), OrderError);
    assert.throws(() => normalizeItems([{ productId: 'labial', qty: -1 }]), OrderError);
    assert.throws(() => normalizeItems([{ productId: 'labial', qty: 100 }]), OrderError);
  });
});

describe('buildOrder', () => {
  it('calcula el total con los precios del servidor', () => {
    const order = buildOrder(products, [
      { productId: 'labial', variantId: null, qty: 2 },
      { productId: 'pines', variantId: 'u8', qty: 1 }
    ]);
    assert.equal(order.total, 204);
    assert.equal(order.amountCents, 20400);
    assert.equal(order.lines[1].variantName, '8 unidades');
    assert.equal(order.lines[1].unitPrice, 24);
  });

  it('usa el precio del producto si la variante no tiene precio propio', () => {
    const map = new Map([['p', { name: 'P', price: 10, variants: [{ id: 'a', name: 'A', price: null, stock: 3 }] }]]);
    assert.equal(buildOrder(map, [{ productId: 'p', variantId: 'a', qty: 2 }]).total, 20);
  });

  it('rechaza productos agotados, sin stock confirmado, sin precio o eliminados', () => {
    for (const productId of ['agotado', 'sin-stock', 'sin-precio', 'no-existe']) {
      assert.throws(() => buildOrder(products, [{ productId, variantId: null, qty: 1 }]), OrderError, productId);
    }
  });

  it('rechaza cantidades mayores al stock', () => {
    assert.throws(
      () => buildOrder(products, [{ productId: 'labial', variantId: null, qty: 6 }]),
      (error) => error instanceof OrderError && error.details.some((d) => d.includes('solo quedan 5'))
    );
  });

  it('exige una variante válida cuando el producto tiene variantes', () => {
    assert.throws(() => buildOrder(products, [{ productId: 'pines', variantId: null, qty: 1 }]), OrderError);
    assert.throws(() => buildOrder(products, [{ productId: 'pines', variantId: 'u16', qty: 1 }]), OrderError);
  });
});

describe('stockAfterSale', () => {
  it('descuenta el stock de un producto simple', () => {
    assert.deepEqual(stockAfterSale(products.get('labial'), { productId: 'labial', variantId: null, qty: 2, name: 'Tinta labial' }), { stock: 3 });
  });

  it('descuenta el stock de la variante sin modificar las demás', () => {
    const patch = stockAfterSale(products.get('pines'), { productId: 'pines', variantId: 'u1', qty: 4, name: 'Pines', variantName: '1 unidad' });
    assert.equal(patch.variants.find((v) => v.id === 'u1').stock, 6);
    assert.equal(patch.variants.find((v) => v.id === 'u8').stock, 2);
    assert.equal(products.get('pines').variants[0].stock, 10, 'no muta el original');
  });

  it('falla si el stock ya no alcanza', () => {
    assert.throws(() => stockAfterSale(products.get('labial'), { productId: 'labial', variantId: null, qty: 9, name: 'Tinta labial' }), OrderError);
  });
});

describe('validateCustomer', () => {
  it('normaliza los datos de entrega', () => {
    const c = validateCustomer({ ...customer, notes: '  Entregar   en la tarde ' });
    assert.equal(c.email, 'lucia@example.com');
    assert.equal(c.notes, 'Entregar en la tarde');
  });

  it('rechaza celular o correo no válidos', () => {
    assert.throws(() => validateCustomer({ ...customer, phone: '12345' }), /celular/);
    assert.throws(() => validateCustomer({ ...customer, email: 'sin-arroba' }), /correo/);
  });
});
