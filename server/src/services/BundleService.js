// Master Paket Promo (bundle). Paket dijual di invoice sbg 1 baris dgn harga
// paket; OrderService memecahnya jadi baris per isi (stok/HPP per produk).
// bundle_items = konfigurasi master (bukan data transaksi) — boleh diganti
// total saat paket diubah; invoice lama tidak terpengaruh karena menyimpan
// snapshot sendiri di sale_items.
const { v4: uuidv4 } = require('uuid');
const Decimal = require('decimal.js');
const pool = require('../config/db');
const HttpError = require('../utils/HttpError');
const { getDefaultWarehouseId } = require('./WarehouseService');

// Level harga default = yang pertama urut nama (sama dgn pilihan awal di
// layar Buat Invoice).
async function getDefaultPriceLevelId(conn = pool) {
  const [[row]] = await conn.query(`SELECT id FROM price_levels ORDER BY name LIMIT 1`);
  return row ? row.id : null;
}

// Isi paket + angka acuan per isi: harga normal (level harga tertentu),
// HPP berjalan, BV. Dipakai layar master (acuan menetapkan harga paket) &
// OrderService (bobot pembagian harga paket ke tiap isi).
async function loadBundleItems(conn, bundleId, { priceLevelId = null, warehouseId = null } = {}) {
  const levelId = priceLevelId || (await getDefaultPriceLevelId(conn));
  const whId = warehouseId || (await getDefaultWarehouseId(conn));
  const [rows] = await conn.query(
    `SELECT bi.id, bi.product_id, bi.unit_id, bi.quantity, bi.sort_order,
            p.name AS product_name, p.sku, p.is_active AS product_active, p.bv_points, p.is_service,
            u.name AS unit_name, pu.conversion_factor,
            COALESCE(sb.avg_cost_per_base_unit, 0) AS avg_cost,
            COALESCE(sb.qty_base, 0) AS stock_qty_base
     FROM bundle_items bi
     JOIN products p ON p.id = bi.product_id
     JOIN units u ON u.id = bi.unit_id
     LEFT JOIN product_units pu ON pu.product_id = bi.product_id AND pu.unit_id = bi.unit_id
     LEFT JOIN stock_balances sb ON sb.product_id = bi.product_id AND sb.warehouse_id = ?
     WHERE bi.bundle_id = ?
     ORDER BY bi.sort_order ASC, bi.id ASC`,
    [whId, bundleId]
  );

  const items = [];
  for (const r of rows) {
    const quantity = new Decimal(r.quantity);
    const conversion = new Decimal(r.conversion_factor || 1);
    const quantityBase = quantity.mul(conversion);
    let normalPrice = null;
    if (levelId) {
      const [[priceRow]] = await conn.query(
        `SELECT price FROM product_prices
         WHERE product_id = ? AND unit_id = ? AND price_level_id = ? AND min_qty_base <= ?
         ORDER BY min_qty_base DESC LIMIT 1`,
        [r.product_id, r.unit_id, levelId, quantityBase.toFixed(4)]
      );
      if (priceRow) normalPrice = new Decimal(priceRow.price).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    }
    items.push({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name,
      sku: r.sku,
      productActive: !!r.product_active,
      isService: !!r.is_service,
      unitId: r.unit_id,
      unitName: r.unit_name,
      quantity,
      conversionFactor: conversion,
      quantityBase,
      unitNormalPrice: normalPrice,
      normalTotal: normalPrice ? normalPrice.mul(quantity) : null,
      costTotal: new Decimal(r.avg_cost).mul(quantityBase),
      bvTotal: new Decimal(r.bv_points || 0).mul(quantityBase),
      stockQtyBase: new Decimal(r.stock_qty_base),
    });
  }
  return items;
}

function formatBundle(row, items) {
  const normalTotal = items.reduce((s, i) => s.plus(i.normalTotal || 0), new Decimal(0));
  const costTotal = items.reduce((s, i) => s.plus(i.costTotal), new Decimal(0));
  const bvFromItems = items.reduce((s, i) => s.plus(i.bvTotal), new Decimal(0));
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    price: String(row.price),
    bvPoints: row.bv_points === null ? null : new Decimal(row.bv_points).toFixed(2),
    effectiveBv: (row.bv_points === null ? bvFromItems : new Decimal(row.bv_points)).toFixed(2),
    notes: row.notes,
    isActive: !!row.is_active,
    normalTotal: normalTotal.toFixed(0),
    costTotal: costTotal.toFixed(0),
    missingNormalPrice: items.some((i) => i.normalTotal === null),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      sku: i.sku,
      productActive: i.productActive,
      unitId: i.unitId,
      unitName: i.unitName,
      quantity: i.quantity.toFixed(4),
      normalTotal: i.normalTotal ? i.normalTotal.toFixed(0) : null,
      costTotal: i.costTotal.toFixed(0),
    })),
  };
}

async function listBundles({ includeInactive = false } = {}) {
  const [rows] = await pool.query(
    `SELECT * FROM bundles ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY is_active DESC, name ASC`
  );
  const result = [];
  for (const row of rows) result.push(formatBundle(row, await loadBundleItems(pool, row.id)));
  return result;
}

async function getBundle(id) {
  const [[row]] = await pool.query(`SELECT * FROM bundles WHERE id = ?`, [id]);
  if (!row) throw new HttpError(404, 'bundle_not_found', 'Paket promo tidak ditemukan');
  return formatBundle(row, await loadBundleItems(pool, id));
}

function cleanStr(v, maxLen) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = String(v).trim();
  if (!t) return null;
  if (maxLen && t.length > maxLen) throw new HttpError(400, 'bad_request', `Isian terlalu panjang (maks ${maxLen} karakter)`);
  return t;
}

function parsePrice(raw) {
  const price = new Decimal(raw === undefined || raw === null || raw === '' ? -1 : raw);
  if (!price.isInteger() || price.lt(0)) throw new HttpError(400, 'bad_request', 'Harga paket wajib rupiah bulat >= 0');
  return price.toFixed(0);
}

function parseBv(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'bad_request', 'Poin BV harus angka >= 0');
  return n;
}

async function validateAndInsertItems(conn, bundleId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'bad_request', 'Paket minimal berisi 1 produk');
  }
  let order = 0;
  for (const it of items) {
    const qty = new Decimal(it.quantity || 0);
    if (!it.productId || !it.unitId || qty.lte(0)) {
      throw new HttpError(400, 'bad_request', 'Setiap isi paket wajib punya produk, satuan, dan qty > 0');
    }
    const [[pu]] = await conn.query(
      `SELECT pu.id FROM product_units pu JOIN products p ON p.id = pu.product_id
       WHERE pu.product_id = ? AND pu.unit_id = ?`,
      [it.productId, it.unitId]
    );
    if (!pu) throw new HttpError(400, 'invalid_unit', 'Satuan tidak valid untuk salah satu isi paket');
    await conn.query(
      `INSERT INTO bundle_items (id, bundle_id, product_id, unit_id, quantity, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), bundleId, it.productId, it.unitId, qty.toFixed(4), order++]
    );
  }
}

async function createBundle({ code, name, price, bvPoints, notes, items }) {
  const cleanName = cleanStr(name, 150);
  if (!cleanName) throw new HttpError(400, 'bad_request', 'Nama paket wajib diisi');
  const id = uuidv4();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO bundles (id, code, name, price, bv_points, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, cleanStr(code, 50) ?? null, cleanName, parsePrice(price), parseBv(bvPoints) ?? null, cleanStr(notes) ?? null]
    );
    await validateAndInsertItems(conn, id, items);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'duplicate_code', `Kode paket "${code}" sudah dipakai`);
    throw err;
  } finally {
    conn.release();
  }
  return getBundle(id);
}

// Partial update. items dikirim = isi paket diganti total.
async function updateBundle(id, { code, name, price, bvPoints, notes, isActive, items }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query(`SELECT * FROM bundles WHERE id = ? FOR UPDATE`, [id]);
    if (!row) throw new HttpError(404, 'bundle_not_found', 'Paket promo tidak ditemukan');
    const next = {
      code: code !== undefined ? cleanStr(code, 50) : row.code,
      name: name !== undefined ? cleanStr(name, 150) : row.name,
      price: price !== undefined ? parsePrice(price) : row.price,
      bv: bvPoints !== undefined ? parseBv(bvPoints) : row.bv_points,
      notes: notes !== undefined ? cleanStr(notes) : row.notes,
      active: isActive !== undefined ? (isActive ? 1 : 0) : row.is_active,
    };
    if (!next.name) throw new HttpError(400, 'bad_request', 'Nama paket wajib diisi');
    await conn.query(
      `UPDATE bundles SET code = ?, name = ?, price = ?, bv_points = ?, notes = ?, is_active = ? WHERE id = ?`,
      [next.code, next.name, next.price, next.bv, next.notes, next.active, id]
    );
    if (items !== undefined) {
      await conn.query(`DELETE FROM bundle_items WHERE bundle_id = ?`, [id]);
      await validateAndInsertItems(conn, id, items);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'duplicate_code', `Kode paket "${code}" sudah dipakai`);
    throw err;
  } finally {
    conn.release();
  }
  return getBundle(id);
}

module.exports = { listBundles, getBundle, createBundle, updateBundle, loadBundleItems };
