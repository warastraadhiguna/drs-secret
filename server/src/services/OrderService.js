// Invoice/Pesanan — alur jual DR's Secret (chat/WA -> invoice A4 -> transfer
// -> kirim). Disimpan di tabel `sales` dgn channel='order' supaya laporan
// penjualan, retur, laba, & jurnal yang sudah ada tetap berlaku, tapi:
//  - TANPA shift kasir (cashier_shift_id NULL).
//  - Nomor invoice urut dari store_settings.next_invoice_number (dikunci
//    FOR UPDATE di transaksi yang sama — tidak bisa dobel walau dua admin
//    membuat invoice bersamaan). sale_number = "INV-<nomor>".
//  - Pendapatan diakui saat invoice dibuat dgn lawan Piutang Usaha;
//    pembayaran dicatat terpisah (boleh langsung, belakangan, atau bertahap).
//  - Ongkir = baris tersendiri (shipping_fee), di luar DPP/PPN, dijurnal ke
//    Pendapatan Ongkos Kirim. grand_total = nilai barang saja; total_due =
//    grand_total + ongkir = yang ditagih ke pelanggan.
//  - Baris bonus/gratis: harga 0, tidak memicu aturan jual-di-bawah-HPP,
//    HPP-nya dijurnal ke Beban Promosi. sales.total_cost MENCAKUP biaya bonus
//    (laba kotor invoice = setelah promosi), sedangkan jurnal memisahkan HPP
//    vs Beban Promosi — laba bersih di laporan keuangan tetap sama.
//  - Stok dipotong saat invoice dibuat (pesanan indent menyusul sbg fitur
//    terpisah).
// Server satu-satunya otoritas harga — client cuma kirim produk/satuan/qty.
const { v4: uuidv4 } = require('uuid');
const Decimal = require('decimal.js');
const pool = require('../config/db');
const HttpError = require('../utils/HttpError');
const { logActivity } = require('./AuthService');
const { applyStockMovement } = require('./StockMovementService');
const { getDefaultWarehouseId } = require('./WarehouseService');
const { getActiveMethodById } = require('./PaymentMethodService');
const JournalService = require('./JournalService');
const StoreSettingsService = require('./StoreSettingsService');
const BelowCostAuthorizationService = require('./BelowCostAuthorizationService');
const BundleService = require('./BundleService');
const { resolveItemPricing, computeTotalDiscount, applyPpn, getEffectivePpnSettings } = require('./SalesService');

const BRANCH_ID = 1;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_SHIPPING_METHODS = ['JNT', 'JNE', 'JNE YES', 'KC', 'Kurir', 'Ambil sendiri'];

// Kolom DATE dari mysql2 = objek Date tengah malam waktu LOKAL server —
// dikirim ke client sbg string YYYY-MM-DD supaya tidak bergeser sehari
// kalau zona waktu browser beda dari server.
function toDateStr(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayLocal() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function assertDate(value, label) {
  if (!DATE_REGEX.test(value || '')) {
    throw new HttpError(400, 'bad_request', `${label} wajib format YYYY-MM-DD`);
  }
}

function cleanText(value, maxLen) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (maxLen && trimmed.length > maxLen) {
    throw new HttpError(400, 'bad_request', `Isian terlalu panjang (maks ${maxLen} karakter)`);
  }
  return trimmed;
}

function parseShippingFee(raw) {
  const fee = new Decimal(raw || 0);
  if (!fee.isInteger() || fee.lt(0)) {
    throw new HttpError(400, 'bad_request', 'Ongkir harus angka rupiah bulat >= 0');
  }
  return fee;
}

function computePaymentStatus(totalDue, amountPaid) {
  const due = new Decimal(totalDue);
  const paid = new Decimal(amountPaid);
  if (paid.gte(due)) return 'paid';
  if (paid.gt(0)) return 'partial';
  return 'unpaid';
}

async function getProductInfo(conn, productId) {
  const [[row]] = await conn.query(
    `SELECT id, name, sku, bv_points, is_active, is_service FROM products WHERE id = ?`,
    [productId]
  );
  if (!row) throw new HttpError(400, 'product_not_found', `Produk ${productId} tidak ditemukan`);
  if (!row.is_active) throw new HttpError(400, 'product_inactive', `Produk ${row.name} sudah nonaktif`);
  return row;
}

// Baris bonus TIDAK lewat resolveItemPricing — produk bonus (mis. sachet,
// eye mask per lembar) boleh saja belum punya harga jual di master, dan
// harganya memang 0. Cuma butuh konversi satuan + HPP berjalan.
async function resolveBonusItem(conn, item, warehouseId) {
  const quantity = new Decimal(item.quantity);
  const [[productUnit]] = await conn.query(
    `SELECT conversion_factor FROM product_units WHERE product_id = ? AND unit_id = ? LIMIT 1`,
    [item.productId, item.unitId]
  );
  if (!productUnit) throw new HttpError(400, 'invalid_unit', `Satuan tidak valid untuk produk ${item.productId}`);
  const conversionFactor = new Decimal(productUnit.conversion_factor);
  const quantityBase = quantity.mul(conversionFactor);
  const [[balanceRow]] = await conn.query(
    `SELECT avg_cost_per_base_unit FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`,
    [warehouseId, item.productId]
  );
  const avgCost = balanceRow ? new Decimal(balanceRow.avg_cost_per_base_unit) : new Decimal(0);
  return {
    productId: item.productId,
    unitId: item.unitId,
    quantity,
    conversionFactor,
    quantityBase,
    price: '0',
    basePrice: new Decimal(0),
    manualPriceApplied: false,
    grossSubtotal: new Decimal(0),
    discountType: null,
    discountValue: new Decimal(0),
    discountAmount: new Decimal(0),
    subtotal: new Decimal(0),
    itemTotalCost: avgCost.mul(quantityBase),
    isBelowCost: false,
    belowCostErrorCode: null,
    belowCostMessage: null,
  };
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'bad_request', 'Invoice minimal berisi 1 barang');
  }
  for (const item of items) {
    const qty = new Decimal(item.quantity || 0);
    if (qty.lte(0)) throw new HttpError(400, 'bad_request', 'Qty harus lebih dari 0');
    if (item.bundleId) {
      if (!qty.isInteger()) throw new HttpError(400, 'bad_request', 'Qty paket promo harus bilangan bulat');
      continue;
    }
    if (!item.productId || !item.unitId) {
      throw new HttpError(400, 'bad_request', 'Setiap baris wajib punya produk & satuan');
    }
    if (!item.isBonus && !item.priceLevelId) {
      throw new HttpError(400, 'bad_request', 'Level harga wajib diisi untuk barang berbayar');
    }
  }
}

// Bagi `total` (Decimal) ke beberapa bagian sebanding `weights` dgn
// `decimals` angka di belakang koma; sisa pembulatan masuk bagian terakhir
// supaya jumlahnya PERSIS sama dgn total.
function allocate(total, weights, decimals = 0) {
  const sumW = weights.reduce((s, w) => s.plus(w), new Decimal(0));
  const n = weights.length;
  const parts = [];
  let used = new Decimal(0);
  for (let i = 0; i < n; i++) {
    let part;
    if (i === n - 1) part = total.minus(used);
    else if (sumW.gt(0)) part = total.mul(weights[i]).div(sumW).toDecimalPlaces(decimals, Decimal.ROUND_DOWN);
    else part = total.div(n).toDecimalPlaces(decimals, Decimal.ROUND_DOWN);
    parts.push(part);
    used = used.plus(part);
  }
  return parts;
}

// Paket promo -> 1 baris per isi paket. Harga paket dibagi ke tiap isi
// sebanding HARGA NORMAL isi tsb (level harga invoice); kalau ada isi yang
// belum punya harga normal, sebanding HPP; kalau HPP juga nol, rata.
// BV paket: bundles.bv_points kalau diisi (dibagi dgn bobot yang sama),
// kalau NULL = jumlah BV isinya.
async function expandBundle(conn, item, warehouseId) {
  const [[bundle]] = await conn.query(`SELECT * FROM bundles WHERE id = ?`, [item.bundleId]);
  if (!bundle) throw new HttpError(400, 'bundle_not_found', 'Paket promo tidak ditemukan');
  if (!bundle.is_active) throw new HttpError(400, 'bundle_inactive', `Paket ${bundle.name} sudah nonaktif`);
  const comps = await BundleService.loadBundleItems(conn, bundle.id, { priceLevelId: item.priceLevelId, warehouseId });
  if (comps.length === 0) throw new HttpError(400, 'bundle_empty', `Paket ${bundle.name} belum punya isi`);
  const inactive = comps.find((c) => !c.productActive);
  if (inactive) throw new HttpError(400, 'product_inactive', `Isi paket ${bundle.name} (${inactive.productName}) sudah nonaktif`);

  const bundleQty = new Decimal(item.quantity);
  const gross = new Decimal(bundle.price).mul(bundleQty);
  const allPriced = comps.every((c) => c.normalTotal && c.normalTotal.gt(0));
  const weights = comps.map((c) => (allPriced ? c.normalTotal : c.costTotal));
  const amounts = allocate(gross, weights, 0);
  const bvTotals = bundle.bv_points === null
    ? comps.map((c) => c.bvTotal.mul(bundleQty))
    : allocate(new Decimal(bundle.bv_points).mul(bundleQty), weights, 2);

  const group = uuidv4();
  const lines = comps.map((c, idx) => {
    const quantity = c.quantity.mul(bundleQty);
    const quantityBase = c.quantityBase.mul(bundleQty);
    const amount = amounts[idx];
    return {
      item,
      isBonus: false,
      product: { name: c.productName, is_service: c.isService ? 1 : 0 },
      bvPoints: bvTotals[idx],
      bundle: { bundleId: bundle.id, group, name: bundle.name, qty: bundleQty, price: new Decimal(bundle.price) },
      pricing: {
        productId: c.productId,
        unitId: c.unitId,
        unitName: c.unitName,
        quantity,
        conversionFactor: c.conversionFactor,
        quantityBase,
        price: amount.div(quantity).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0),
        basePrice: amount,
        manualPriceApplied: false,
        grossSubtotal: amount,
        discountType: null,
        discountValue: new Decimal(0),
        discountAmount: new Decimal(0),
        subtotal: amount,
        itemTotalCost: c.costTotal.mul(bundleQty),
        isBelowCost: false,
      },
    };
  });
  const cost = lines.reduce((s, l) => s.plus(l.pricing.itemTotalCost), new Decimal(0));
  const belowCostMessage = gross.lt(cost)
    ? `Harga paket ${bundle.name} (Rp${gross.toFixed(0)}) di bawah total HPP isinya (Rp${cost.toFixed(0)}).`
    : null;
  return { lines, belowCostMessage };
}

// Hitung seluruh invoice (dipakai preview & create). `conn` = pool utk
// preview, koneksi transaksi utk create. Tidak menulis apa pun.
async function computeOrder(conn, { items, totalDiscountType, totalDiscountValue, shippingFee }, warehouseId) {
  validateItems(items);
  const shippingFeeDec = parseShippingFee(shippingFee);

  let subtotalSum = new Decimal(0);
  let itemDiscountSum = new Decimal(0);
  let saleCostSum = new Decimal(0);
  let bonusCostSum = new Decimal(0);
  let bvSum = new Decimal(0);
  const lines = [];
  let bundleBelowCostMessage = null;

  for (const item of items) {
    let produced;
    if (item.bundleId) {
      const expanded = await expandBundle(conn, item, warehouseId);
      produced = expanded.lines;
      if (expanded.belowCostMessage && !bundleBelowCostMessage) bundleBelowCostMessage = expanded.belowCostMessage;
    } else {
      const isBonus = !!item.isBonus;
      const product = await getProductInfo(conn, item.productId);
      const pricing = isBonus
        ? await resolveBonusItem(conn, item, warehouseId)
        : await resolveItemPricing(conn, item, warehouseId);
      const bvPoints = isBonus ? new Decimal(0) : new Decimal(product.bv_points || 0).mul(pricing.quantityBase);
      produced = [{ item, isBonus, product, pricing, bvPoints, bundle: null }];
    }
    for (const line of produced) {
      lines.push(line);
      subtotalSum = subtotalSum.plus(line.pricing.grossSubtotal);
      itemDiscountSum = itemDiscountSum.plus(line.pricing.discountAmount);
      if (line.isBonus) bonusCostSum = bonusCostSum.plus(line.pricing.itemTotalCost);
      else saleCostSum = saleCostSum.plus(line.pricing.itemTotalCost);
      bvSum = bvSum.plus(line.bvPoints);
    }
  }

  const subtotalAfterItemDiscount = subtotalSum.minus(itemDiscountSum);
  const totalDiscount = computeTotalDiscount({ totalDiscountType, totalDiscountValue }, subtotalAfterItemDiscount);
  const goodsTotal = subtotalAfterItemDiscount.minus(totalDiscount.amount);
  if (goodsTotal.lt(0)) throw new HttpError(400, 'invalid_discount', 'Diskon total melebihi subtotal');

  // Aturan HPP cuma utk barang berbayar — bonus memang sengaja di bawah HPP.
  const itemBelowCost = lines.find((l) => !l.isBonus && l.pricing.isBelowCost);
  const notaBelowCost = goodsTotal.lt(saleCostSum);
  let belowCostMessage = null;
  if (itemBelowCost) {
    belowCostMessage = `${itemBelowCost.product.name}: ${itemBelowCost.pricing.belowCostMessage}`;
  } else if (bundleBelowCostMessage) {
    belowCostMessage = bundleBelowCostMessage;
  } else if (notaBelowCost) {
    belowCostMessage = `Diskon total membuat invoice terjual di bawah total HPP (Rp${saleCostSum.toFixed(0)}). Maksimal diskon total Rp${subtotalAfterItemDiscount.minus(saleCostSum).toFixed(0)}.`;
  }

  const ppn = applyPpn(goodsTotal, await getEffectivePpnSettings());
  const totalDue = ppn.grandTotal.plus(shippingFeeDec);

  return {
    lines,
    subtotalSum,
    itemDiscountSum,
    subtotalAfterItemDiscount,
    totalDiscount,
    discountSum: itemDiscountSum.plus(totalDiscount.amount),
    goodsTotal,
    ppn,
    shippingFee: shippingFeeDec,
    totalDue,
    saleCostSum,
    bonusCostSum,
    bvSum,
    isBelowCost: !!itemBelowCost || !!bundleBelowCostMessage || notaBelowCost,
    belowCostMessage,
  };
}

// Preview read-only utk layar Buat Invoice. Tidak pernah melempar error
// karena di bawah HPP — cuma ditandai, supaya admin melihat peringatannya
// sebelum menyimpan.
async function previewOrder(payload) {
  const warehouseId = await getDefaultWarehouseId();
  const result = await computeOrder(pool, payload, warehouseId);

  const items = [];
  const bundleItemByGroup = {};
  for (const { item, isBonus, product, pricing, bvPoints, bundle } of result.lines) {
    const [[balance]] = await pool.query(
      `SELECT qty_base FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`,
      [warehouseId, pricing.productId]
    );
    const availableQty = new Decimal(balance ? balance.qty_base : 0);
    // Jasa/non-stok selalu dianggap tersedia.
    const isService = !!product.is_service;

    // Paket dikembalikan sbg 1 item, isinya di `components`.
    if (bundle) {
      let agg = bundleItemByGroup[bundle.group];
      if (!agg) {
        agg = {
          clientKey: item.clientKey,
          isBundle: true,
          bundleId: bundle.bundleId,
          productName: bundle.name,
          quantity: bundle.qty.toFixed(4),
          isBonus: false,
          price: bundle.price.toFixed(0),
          subtotal: new Decimal(0),
          bvPoints: new Decimal(0),
          inStock: true,
          isBelowCost: false,
          isIndent: !!item.isIndent,
          components: [],
        };
        bundleItemByGroup[bundle.group] = agg;
        items.push(agg);
      }
      const compInStock = isService || availableQty.gte(pricing.quantityBase);
      agg.subtotal = agg.subtotal.plus(pricing.subtotal);
      agg.bvPoints = agg.bvPoints.plus(bvPoints);
      agg.inStock = agg.inStock && compInStock;
      agg.components.push({
        productName: product.name,
        quantity: pricing.quantity.toFixed(4),
        unitName: pricing.unitName,
        allocated: pricing.subtotal.toFixed(0),
        inStock: compInStock,
        availableQty: availableQty.toFixed(4),
      });
      continue;
    }

    items.push({
      productId: pricing.productId,
      productName: product.name,
      unitId: pricing.unitId,
      quantity: pricing.quantity.toFixed(4),
      isBonus,
      price: pricing.price,
      basePrice: pricing.basePrice.toFixed(0),
      grossSubtotal: pricing.grossSubtotal.toFixed(0),
      discountAmount: pricing.discountAmount.toFixed(0),
      subtotal: pricing.subtotal.toFixed(0),
      bvPoints: bvPoints.toFixed(2),
      inStock: isService || availableQty.gte(pricing.quantityBase),
      isService,
      availableQty: availableQty.toFixed(4),
      isBelowCost: !isBonus && pricing.isBelowCost,
      isIndent: !!item.isIndent,
      clientKey: item.clientKey,
    });
  }
  for (const agg of Object.values(bundleItemByGroup)) {
    agg.subtotal = agg.subtotal.toFixed(0);
    agg.bvPoints = agg.bvPoints.toFixed(2);
  }

  return {
    items,
    subtotal: result.subtotalSum.toFixed(0),
    itemDiscountTotal: result.itemDiscountSum.toFixed(0),
    totalDiscountAmount: result.totalDiscount.amount.toFixed(0),
    discountTotal: result.discountSum.toFixed(0),
    dpp: result.ppn.dpp.toFixed(0),
    ppnEnabled: result.ppn.ppnApplied,
    ppnRate: result.ppn.ppnRate ? result.ppn.ppnRate.toFixed(4) : null,
    ppnMode: result.ppn.ppnMode,
    ppnAmount: result.ppn.ppnAmount.toFixed(0),
    grandTotal: result.ppn.grandTotal.toFixed(0),
    shippingFee: result.shippingFee.toFixed(0),
    totalDue: result.totalDue.toFixed(0),
    bvTotal: result.bvSum.toFixed(2),
    isBelowCost: result.isBelowCost,
    belowCostMessage: result.belowCostMessage,
  };
}

// Mencatat 1 pembayaran di dalam transaksi yang sudah berjalan (sale sudah
// dikunci FOR UPDATE oleh pemanggil).
async function insertPayment(conn, sale, { paymentMethodId, amount, paymentDate, notes, userId }) {
  const amountDec = new Decimal(amount || 0);
  if (!amountDec.isInteger() || amountDec.lte(0)) {
    throw new HttpError(400, 'bad_request', 'Jumlah pembayaran harus rupiah bulat > 0');
  }
  const remaining = new Decimal(sale.total_due).minus(sale.amount_paid);
  if (amountDec.gt(remaining)) {
    throw new HttpError(400, 'overpayment', `Pembayaran melebihi sisa tagihan (sisa Rp${remaining.toFixed(0)})`);
  }
  const date = paymentDate || todayLocal();
  assertDate(date, 'Tanggal bayar');
  if (!paymentMethodId) throw new HttpError(400, 'bad_request', 'Metode pembayaran wajib dipilih');
  const method = await getActiveMethodById(paymentMethodId);

  const paymentId = uuidv4();
  await conn.query(
    `INSERT INTO sale_payments
       (id, sale_id, payment_method_id, payment_method_name, amount, payment_date, notes, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [paymentId, sale.id, method.id, method.name, amountDec.toFixed(0), date, cleanText(notes, 255), userId]
  );

  const newPaid = new Decimal(sale.amount_paid).plus(amountDec);
  const newStatus = computePaymentStatus(sale.total_due, newPaid);
  await conn.query(`UPDATE sales SET amount_paid = ?, payment_status = ? WHERE id = ?`, [newPaid.toFixed(0), newStatus, sale.id]);

  const label = `Invoice #${sale.invoice_number}`;
  await JournalService.postOrderPaymentJournal(conn, {
    paymentId,
    label,
    entryDate: date,
    amount: amountDec,
    isCashPayment: !!method.is_cash,
    createdBy: userId,
  });
  await logActivity(conn, {
    userId,
    action: 'order_payment',
    entityType: 'sale',
    entityUuid: sale.id,
    description: `Pembayaran ${label} Rp${amountDec.toFixed(0)} via ${method.name} (${date})`,
  });

  sale.amount_paid = newPaid.toFixed(0);
  sale.payment_status = newStatus;
  return paymentId;
}

async function createOrder({
  userId, userRole, customerId, invoiceDate, dueDate, items, totalDiscountType = null, totalDiscountValue = 0,
  shippingFee = 0, shippingMethod, shippingAddress, notes, initialPayment = null, belowCostReason = null,
}) {
  if (!customerId) throw new HttpError(400, 'bad_request', 'Pelanggan wajib dipilih');
  const date = invoiceDate || todayLocal();
  assertDate(date, 'Tanggal invoice');
  if (dueDate) assertDate(dueDate, 'Jatuh tempo');

  const warehouseId = await getDefaultWarehouseId();
  const saleId = uuidv4();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[customer]] = await conn.query(`SELECT * FROM customers WHERE id = ? AND branch_id = ?`, [customerId, BRANCH_ID]);
    if (!customer) throw new HttpError(404, 'customer_not_found', 'Pelanggan tidak ditemukan');
    if (!customer.is_active) throw new HttpError(409, 'customer_inactive', 'Pelanggan ini sudah dinonaktifkan');

    const result = await computeOrder(conn, { items, totalDiscountType, totalDiscountValue, shippingFee }, warehouseId);

    const reason = (belowCostReason || '').trim();
    if (result.isBelowCost) {
      const canOverride = reason && (await BelowCostAuthorizationService.roleHasSellBelowCostPermission(userRole));
      if (!canOverride) {
        throw new HttpError(400, 'below_cost', `${result.belowCostMessage} Hanya Owner (izin jual di bawah HPP) yang bisa menyimpan invoice ini dengan mengisi alasan.`);
      }
    }

    // Nomor invoice — dikunci di transaksi yang sama.
    await StoreSettingsService.getSettings(); // pastikan baris singleton ada
    const [[settings]] = await conn.query(
      `SELECT next_invoice_number FROM store_settings WHERE branch_id = ? FOR UPDATE`,
      [BRANCH_ID]
    );
    const invoiceNumber = Number(settings.next_invoice_number);
    await conn.query(`UPDATE store_settings SET next_invoice_number = ? WHERE branch_id = ?`, [invoiceNumber + 1, BRANCH_ID]);
    const saleNumber = `INV-${invoiceNumber}`;
    const label = `Invoice #${invoiceNumber}`;

    // Potong stok & snapshot HPP per baris. Baris indent (item.isIndent;
    // utk paket berlaku ke semua isinya) dilewati — stok & HPP-nya baru
    // diproses saat dipenuhi (fulfillIndent), nilai jualnya ditahan.
    const itemRows = [];
    let saleCostActual = new Decimal(0);
    let bonusCostActual = new Decimal(0);
    let deferredRevenue = new Decimal(0);
    for (const { item, isBonus, product, pricing, bvPoints, bundle } of result.lines) {
      if (item.isIndent && !product.is_service) {
        deferredRevenue = deferredRevenue.plus(pricing.subtotal);
        itemRows.push({
          id: uuidv4(),
          productId: pricing.productId,
          unitId: pricing.unitId,
          quantity: pricing.quantity.toFixed(4),
          conversionFactor: pricing.conversionFactor.toFixed(4),
          quantityBase: pricing.quantityBase.toFixed(4),
          sellingPrice: pricing.price,
          discountAmount: pricing.discountAmount.toFixed(0),
          subtotal: pricing.subtotal.toFixed(0),
          costPerBaseUnit: '0',
          totalCost: '0',
          grossProfit: '0',
          isBonus: isBonus ? 1 : 0,
          bvPoints: bvPoints.toFixed(2),
          lineNo: itemRows.length + 1,
          bundle,
          fulfillmentStatus: 'pending',
        });
        continue;
      }
      // Jasa/non-stok: tidak ada stok & HPP sama sekali.
      let avgCostPerBaseUnit = new Decimal(0);
      if (!product.is_service) {
        const [[balance]] = await conn.query(
          `SELECT qty_base FROM stock_balances WHERE warehouse_id = ? AND product_id = ? FOR UPDATE`,
          [warehouseId, pricing.productId]
        );
        const currentQty = new Decimal(balance ? balance.qty_base : 0);
        if (currentQty.lt(pricing.quantityBase)) {
          throw new HttpError(409, 'insufficient_stock', `Stok ${product.name} tidak cukup (tersedia ${currentQty.toFixed(2)} satuan dasar)`);
        }
        ({ avgCostPerBaseUnit } = await applyStockMovement(conn, {
          warehouseId,
          productId: pricing.productId,
          movementType: 'sale',
          referenceType: 'sale',
          referenceUuid: saleId,
          qtyOutBase: pricing.quantityBase.toFixed(4),
          movementDate: new Date(),
        }));
      }
      const totalCost = avgCostPerBaseUnit.mul(pricing.quantityBase);
      if (isBonus) bonusCostActual = bonusCostActual.plus(totalCost);
      else saleCostActual = saleCostActual.plus(totalCost);
      itemRows.push({
        id: uuidv4(),
        productId: pricing.productId,
        unitId: pricing.unitId,
        quantity: pricing.quantity.toFixed(4),
        conversionFactor: pricing.conversionFactor.toFixed(4),
        quantityBase: pricing.quantityBase.toFixed(4),
        sellingPrice: pricing.price,
        discountAmount: pricing.discountAmount.toFixed(0),
        subtotal: pricing.subtotal.toFixed(0),
        costPerBaseUnit: avgCostPerBaseUnit.toFixed(4),
        totalCost: totalCost.toFixed(4),
        grossProfit: pricing.subtotal.minus(totalCost).toFixed(4),
        isBonus: isBonus ? 1 : 0,
        bvPoints: bvPoints.toFixed(2),
        lineNo: itemRows.length + 1,
        bundle,
        fulfillmentStatus: 'fulfilled',
      });
    }

    const totalCostAll = saleCostActual.plus(bonusCostActual);
    const grossProfit = result.ppn.dpp.minus(totalCostAll);
    const address = cleanText(shippingAddress) ?? customer.address ?? null;

    await conn.query(
      `INSERT INTO sales
        (id, branch_id, sale_number, channel, invoice_number, invoice_date, cashier_shift_id, user_id,
         customer_id, customer_name, customer_phone, customer_city, shipping_address,
         shipping_method, shipping_fee, total_due, amount_paid, payment_status, due_date, notes, bv_total,
         subtotal, discount_total, dpp, ppn_rate, ppn_mode, ppn_amount, grand_total, total_cost, gross_profit, status)
       VALUES (?, ?, ?, 'order', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
      [
        saleId, BRANCH_ID, saleNumber, invoiceNumber, date, userId,
        customer.id, customer.name, customer.phone, customer.city, address,
        cleanText(shippingMethod, 50), result.shippingFee.toFixed(0), result.totalDue.toFixed(0),
        computePaymentStatus(result.totalDue, 0), dueDate || null, cleanText(notes), result.bvSum.toFixed(2),
        result.subtotalSum.toFixed(0), result.discountSum.toFixed(0), result.ppn.dpp.toFixed(0),
        result.ppn.ppnRate ? result.ppn.ppnRate.toFixed(4) : null, result.ppn.ppnMode, result.ppn.ppnAmount.toFixed(0),
        result.ppn.grandTotal.toFixed(0), totalCostAll.toFixed(4), grossProfit.toFixed(4),
      ]
    );

    for (const row of itemRows) {
      await conn.query(
        `INSERT INTO sale_items
          (id, sale_id, product_id, unit_id, quantity, conversion_factor, quantity_base, selling_price,
           discount_amount, subtotal, cost_per_base_unit, total_cost, gross_profit, is_bonus, bv_points,
           line_no, bundle_id, bundle_group, bundle_name, bundle_qty, bundle_price,
           fulfillment_status, fulfilled_at, fulfilled_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, saleId, row.productId, row.unitId, row.quantity, row.conversionFactor, row.quantityBase,
          row.sellingPrice, row.discountAmount, row.subtotal, row.costPerBaseUnit, row.totalCost, row.grossProfit,
          row.isBonus, row.bvPoints, row.lineNo,
          row.bundle ? row.bundle.bundleId : null,
          row.bundle ? row.bundle.group : null,
          row.bundle ? row.bundle.name : null,
          row.bundle ? row.bundle.qty.toFixed(4) : null,
          row.bundle ? row.bundle.price.toFixed(0) : null,
          row.fulfillmentStatus,
          row.fulfillmentStatus === 'fulfilled' ? new Date() : null,
          row.fulfillmentStatus === 'fulfilled' ? userId : null,
        ]
      );
    }

    await JournalService.postOrderJournals(conn, {
      saleId,
      label,
      entryDate: date,
      subtotal: result.subtotalSum,
      discountTotal: result.discountSum,
      ppnAmount: result.ppn.ppnAmount,
      ppnMode: result.ppn.ppnMode,
      grandTotal: result.ppn.grandTotal,
      shippingFee: result.shippingFee,
      saleCost: saleCostActual,
      bonusCost: bonusCostActual,
      deferredRevenue,
      createdBy: userId,
    });
    if (deferredRevenue.gt(0)) {
      const pendingCount = itemRows.filter((r) => r.fulfillmentStatus === 'pending').length;
      await logActivity(conn, {
        userId,
        action: 'order_indent',
        entityType: 'sale',
        entityUuid: saleId,
        description: `${label}: ${pendingCount} baris indent (nilai Rp${deferredRevenue.toFixed(0)}) — stok dipotong saat dipenuhi`,
      });
    }

    await logActivity(conn, {
      userId,
      action: 'create_order',
      entityType: 'sale',
      entityUuid: saleId,
      description: `${label} untuk ${customer.name} — total Rp${result.totalDue.toFixed(0)} (ongkir Rp${result.shippingFee.toFixed(0)})`,
    });
    if (result.discountSum.gt(0)) {
      await logActivity(conn, {
        userId,
        action: 'manual_discount',
        entityType: 'sale',
        entityUuid: saleId,
        description: `Diskon pada ${label} — total diskon Rp${result.discountSum.toFixed(0)}`,
      });
    }
    if (result.isBelowCost) {
      await logActivity(conn, {
        userId,
        action: 'sell_below_cost',
        entityType: 'sale',
        entityUuid: saleId,
        description: `Jual di bawah HPP pada ${label} — alasan: ${reason}`,
      });
    }

    if (initialPayment && initialPayment.amount) {
      const sale = { id: saleId, invoice_number: invoiceNumber, total_due: result.totalDue.toFixed(0), amount_paid: '0' };
      await insertPayment(conn, sale, { ...initialPayment, userId });
    }

    await conn.commit();
    return getOrderDetail(saleId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function lockOrder(conn, saleId) {
  const [[sale]] = await conn.query(`SELECT * FROM sales WHERE id = ? FOR UPDATE`, [saleId]);
  if (!sale || sale.channel !== 'order') throw new HttpError(404, 'order_not_found', 'Invoice tidak ditemukan');
  return sale;
}

async function recordPayment(saleId, { paymentMethodId, amount, paymentDate, notes, userId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const sale = await lockOrder(conn, saleId);
    if (sale.status !== 'completed') throw new HttpError(409, 'order_voided', 'Invoice ini sudah di-void');
    await insertPayment(conn, sale, { paymentMethodId, amount, paymentDate, notes, userId });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return getOrderDetail(saleId);
}

// Batalkan 1 pembayaran (salah input / dana dikembalikan) — baris tetap ada
// dgn status 'voided', jurnalnya dibalik.
async function voidPayment(saleId, paymentId, { reason, userId }) {
  const trimmed = (reason || '').trim();
  if (!trimmed) throw new HttpError(400, 'bad_request', 'Alasan pembatalan wajib diisi');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const sale = await lockOrder(conn, saleId);
    const [[payment]] = await conn.query(
      `SELECT * FROM sale_payments WHERE id = ? AND sale_id = ? FOR UPDATE`,
      [paymentId, saleId]
    );
    if (!payment) throw new HttpError(404, 'payment_not_found', 'Pembayaran tidak ditemukan');
    if (payment.status !== 'active') throw new HttpError(409, 'payment_voided', 'Pembayaran ini sudah dibatalkan');

    await conn.query(
      `UPDATE sale_payments SET status = 'voided', voided_at = NOW(), voided_by = ?, void_reason = ? WHERE id = ?`,
      [userId, trimmed.slice(0, 255), paymentId]
    );
    const newPaid = Decimal.max(new Decimal(sale.amount_paid).minus(payment.amount), 0);
    await conn.query(
      `UPDATE sales SET amount_paid = ?, payment_status = ? WHERE id = ?`,
      [newPaid.toFixed(0), computePaymentStatus(sale.total_due, newPaid), saleId]
    );
    const label = `Invoice #${sale.invoice_number}`;
    await JournalService.reverseOrderPaymentJournal(conn, { paymentId, label, entryDate: todayLocal(), createdBy: userId });
    await logActivity(conn, {
      userId,
      action: 'void_order_payment',
      entityType: 'sale',
      entityUuid: saleId,
      description: `Batal pembayaran Rp${payment.amount} pada ${label}. Alasan: ${trimmed}`,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return getOrderDetail(saleId);
}

// Info & status pengiriman — tidak menyentuh uang/stok, jadi boleh diubah.
// shippingStatus: 'pending' | 'shipped'. Ongkir TIDAK bisa diubah di sini
// (sudah dijurnal) — salah ongkir = void lalu buat invoice baru.
async function updateShipping(saleId, { shippingMethod, trackingNumber, shippingAddress, shippingStatus, userId }) {
  if (shippingStatus !== undefined && !['pending', 'shipped'].includes(shippingStatus)) {
    throw new HttpError(400, 'bad_request', "shippingStatus harus 'pending' atau 'shipped'");
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const sale = await lockOrder(conn, saleId);
    if (sale.status !== 'completed') throw new HttpError(409, 'order_voided', 'Invoice ini sudah di-void');

    const next = {
      method: shippingMethod !== undefined ? cleanText(shippingMethod, 50) : sale.shipping_method,
      tracking: trackingNumber !== undefined ? cleanText(trackingNumber, 100) : sale.tracking_number,
      address: shippingAddress !== undefined ? cleanText(shippingAddress) : sale.shipping_address,
      status: shippingStatus !== undefined ? shippingStatus : sale.shipping_status,
    };
    const becameShipped = next.status === 'shipped' && sale.shipping_status !== 'shipped';
    const becamePending = next.status === 'pending' && sale.shipping_status === 'shipped';

    await conn.query(
      `UPDATE sales SET shipping_method = ?, tracking_number = ?, shipping_address = ?, shipping_status = ?,
              shipped_at = ${becameShipped ? 'NOW()' : becamePending ? 'NULL' : 'shipped_at'},
              shipped_by = ${becameShipped ? '?' : becamePending ? 'NULL' : 'shipped_by'}
       WHERE id = ?`,
      becameShipped
        ? [next.method, next.tracking, next.address, next.status, userId, saleId]
        : [next.method, next.tracking, next.address, next.status, saleId]
    );
    if (becameShipped || becamePending) {
      await logActivity(conn, {
        userId,
        action: becameShipped ? 'order_shipped' : 'order_unshipped',
        entityType: 'sale',
        entityUuid: saleId,
        description: `Invoice #${sale.invoice_number} ${becameShipped ? `ditandai terkirim (${next.method || '-'}${next.tracking ? `, resi ${next.tracking}` : ''})` : 'dikembalikan ke status belum dikirim'}`,
      });
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return getOrderDetail(saleId);
}

// Penuhi barang indent: potong stok, snapshot HPP berjalan, pindahkan
// pendapatan yang ditahan ke Penjualan. itemIds kosong/tidak dikirim = semua
// baris indent invoice ini. Isi paket selalu dipenuhi SEKALIGUS satu paket
// (baris lain dgn bundle_group sama ikut diambil) supaya paket tidak
// terkirim setengah. Ditolak seluruhnya kalau stok salah satu barang kurang.
async function fulfillIndent(saleId, { itemIds, userId }) {
  const warehouseId = await getDefaultWarehouseId();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const sale = await lockOrder(conn, saleId);
    if (sale.status !== 'completed') throw new HttpError(409, 'order_voided', 'Invoice ini sudah di-void');

    const [pending] = await conn.query(
      `SELECT si.*, p.name AS product_name FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ? AND si.fulfillment_status = 'pending' ORDER BY si.line_no ASC FOR UPDATE`,
      [saleId]
    );
    if (pending.length === 0) throw new HttpError(409, 'nothing_pending', 'Tidak ada barang indent yang belum dipenuhi');

    let selected = pending;
    if (Array.isArray(itemIds) && itemIds.length > 0) {
      const wanted = new Set(itemIds);
      const groups = new Set(pending.filter((r) => wanted.has(r.id) && r.bundle_group).map((r) => r.bundle_group));
      selected = pending.filter((r) => wanted.has(r.id) || (r.bundle_group && groups.has(r.bundle_group)));
      if (selected.length === 0) throw new HttpError(400, 'bad_request', 'Baris yang dipilih bukan barang indent yang belum dipenuhi');
    }

    let revenue = new Decimal(0);
    let saleCost = new Decimal(0);
    let bonusCost = new Decimal(0);
    const names = [];
    for (const row of selected) {
      const qtyBase = new Decimal(row.quantity_base);
      const [[balance]] = await conn.query(
        `SELECT qty_base FROM stock_balances WHERE warehouse_id = ? AND product_id = ? FOR UPDATE`,
        [warehouseId, row.product_id]
      );
      const currentQty = new Decimal(balance ? balance.qty_base : 0);
      if (currentQty.lt(qtyBase)) {
        throw new HttpError(409, 'insufficient_stock', `Stok ${row.product_name} belum cukup (tersedia ${currentQty.toFixed(2)}, perlu ${qtyBase.toFixed(2)} satuan dasar)`);
      }
      const { avgCostPerBaseUnit } = await applyStockMovement(conn, {
        warehouseId,
        productId: row.product_id,
        movementType: 'sale',
        referenceType: 'sale',
        referenceUuid: saleId,
        qtyOutBase: qtyBase.toFixed(4),
        movementDate: new Date(),
      });
      const cost = avgCostPerBaseUnit.mul(qtyBase);
      await conn.query(
        `UPDATE sale_items
         SET fulfillment_status = 'fulfilled', fulfilled_at = NOW(), fulfilled_by = ?,
             cost_per_base_unit = ?, total_cost = ?, gross_profit = ?
         WHERE id = ?`,
        [userId, avgCostPerBaseUnit.toFixed(4), cost.toFixed(4), new Decimal(row.subtotal).minus(cost).toFixed(4), row.id]
      );
      revenue = revenue.plus(row.subtotal);
      if (row.is_bonus) bonusCost = bonusCost.plus(cost);
      else saleCost = saleCost.plus(cost);
      names.push(row.bundle_name ? `${row.product_name} (paket ${row.bundle_name})` : row.product_name);
    }

    const totalCost = saleCost.plus(bonusCost);
    await conn.query(
      `UPDATE sales SET total_cost = total_cost + ?, gross_profit = gross_profit - ? WHERE id = ?`,
      [totalCost.toFixed(4), totalCost.toFixed(4), saleId]
    );
    const label = `Invoice #${sale.invoice_number}`;
    await JournalService.postIndentFulfillmentJournal(conn, {
      saleId, label, entryDate: todayLocal(), revenue, saleCost, bonusCost, createdBy: userId,
    });
    await logActivity(conn, {
      userId,
      action: 'order_indent_fulfilled',
      entityType: 'sale',
      entityUuid: saleId,
      description: `Indent ${label} dipenuhi: ${names.join(', ')}`,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return getOrderDetail(saleId);
}

// Void invoice: stok dikembalikan pakai snapshot HPP asli, jurnal dibalik.
// Pembayaran aktif harus dibatalkan dulu (eksplisit — supaya jelas uangnya
// dikembalikan atau tidak), dan invoice yang sudah ada returnya tidak bisa
// di-void (stok bisa kembali dua kali).
async function voidOrder(saleId, { reason, userId }) {
  const trimmed = (reason || '').trim();
  if (!trimmed) throw new HttpError(400, 'bad_request', 'Alasan void wajib diisi');
  const warehouseId = await getDefaultWarehouseId();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const sale = await lockOrder(conn, saleId);
    if (sale.status !== 'completed') throw new HttpError(409, 'already_voided', 'Invoice ini sudah di-void');

    const [[activePay]] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM sale_payments WHERE sale_id = ? AND status = 'active'`,
      [saleId]
    );
    if (Number(activePay.cnt) > 0) {
      throw new HttpError(409, 'has_payments', 'Invoice ini masih punya pembayaran aktif — batalkan pembayarannya dulu sebelum void');
    }
    const [[returns]] = await conn.query(`SELECT COUNT(*) AS cnt FROM sales_returns WHERE sale_id = ?`, [saleId]);
    if (Number(returns.cnt) > 0) {
      throw new HttpError(409, 'has_returns', 'Invoice ini sudah punya retur penjualan, tidak bisa di-void');
    }

    // Baris indent yang belum dipenuhi tidak pernah memotong stok — tidak
    // ada yang perlu dikembalikan.
    const [items] = await conn.query(
      `SELECT si.* FROM sale_items si JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ? AND si.fulfillment_status = 'fulfilled' AND p.is_service = 0`,
      [saleId]
    );
    for (const item of items) {
      await applyStockMovement(conn, {
        warehouseId,
        productId: item.product_id,
        movementType: 'void_reversal',
        referenceType: 'sale',
        referenceUuid: saleId,
        qtyInBase: item.quantity_base,
        costPerBaseUnit: item.cost_per_base_unit,
        movementDate: new Date(),
      });
    }

    await conn.query(
      `UPDATE sales SET status = 'voided', void_reason = ?, voided_at = NOW(), voided_by = ? WHERE id = ?`,
      [trimmed, userId, saleId]
    );
    await JournalService.reverseSaleJournals(conn, {
      saleId,
      saleNumber: `Invoice #${sale.invoice_number}`,
      entryDate: todayLocal(),
      createdBy: userId,
    });
    await logActivity(conn, {
      userId,
      action: 'void_order',
      entityType: 'sale',
      entityUuid: saleId,
      description: `Void Invoice #${sale.invoice_number}. Alasan: ${trimmed}`,
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  return getOrderDetail(saleId);
}

function formatOrderRow(row) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    saleNumber: row.sale_number,
    invoiceDate: toDateStr(row.invoice_date),
    dueDate: toDateStr(row.due_date),
    createdAt: row.created_at,
    status: row.status,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerCity: row.customer_city,
    customerPhone: row.customer_phone,
    shippingMethod: row.shipping_method,
    trackingNumber: row.tracking_number,
    shippingStatus: row.shipping_status,
    shippedAt: row.shipped_at,
    grandTotal: new Decimal(row.grand_total).toFixed(0),
    shippingFee: new Decimal(row.shipping_fee).toFixed(0),
    totalDue: new Decimal(row.total_due).toFixed(0),
    amountPaid: new Decimal(row.amount_paid).toFixed(0),
    outstanding: new Decimal(row.total_due).minus(row.amount_paid).toFixed(0),
    paymentStatus: row.payment_status,
    bvTotal: new Decimal(row.bv_total || 0).toFixed(2),
    createdByName: row.created_by_name,
    pendingItemCount: row.pending_item_count !== undefined ? Number(row.pending_item_count) : undefined,
  };
}

// Filter: q (no. invoice / nama / kota / resi), paymentStatus, shippingStatus,
// status ('completed'|'voided'|'all', default completed), startDate/endDate
// (tanggal invoice).
async function listOrders({ q, paymentStatus, shippingStatus, indent, status = 'completed', startDate, endDate, page = 1, limit = 50 } = {}) {
  const where = [`s.channel = 'order'`];
  const params = [];
  if (status && status !== 'all') {
    where.push('s.status = ?');
    params.push(status);
  }
  if (paymentStatus === 'outstanding') {
    where.push(`s.payment_status IN ('unpaid','partial')`);
  } else if (paymentStatus) {
    where.push('s.payment_status = ?');
    params.push(paymentStatus);
  }
  if (shippingStatus) {
    where.push('s.shipping_status = ?');
    params.push(shippingStatus);
  }
  if (indent === 'pending') {
    where.push(`EXISTS (SELECT 1 FROM sale_items pi WHERE pi.sale_id = s.id AND pi.fulfillment_status = 'pending')`);
  }
  if (startDate) {
    assertDate(startDate, 'startDate');
    where.push('s.invoice_date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    assertDate(endDate, 'endDate');
    where.push('s.invoice_date <= ?');
    params.push(endDate);
  }
  const trimmed = (q || '').trim().replace(/^#/, '');
  if (trimmed) {
    where.push('(CAST(s.invoice_number AS CHAR) = ? OR s.customer_name LIKE ? OR s.customer_city LIKE ? OR s.tracking_number LIKE ?)');
    params.push(trimmed, `%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`);
  }
  const whereSql = where.join(' AND ');
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);

  const [[summary]] = await pool.query(
    `SELECT COUNT(*) AS cnt,
            COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total_due ELSE 0 END), 0) AS total_due,
            COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total_due - s.amount_paid ELSE 0 END), 0) AS outstanding
     FROM sales s WHERE ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT s.*, u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM sale_items pi WHERE pi.sale_id = s.id AND pi.fulfillment_status = 'pending') AS pending_item_count
     FROM sales s JOIN users u ON u.id = s.user_id
     WHERE ${whereSql}
     ORDER BY s.invoice_number DESC
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, (safePage - 1) * safeLimit]
  );

  // Total piutang toko (semua invoice aktif yang belum lunas), terlepas filter.
  const [[receivable]] = await pool.query(
    `SELECT COALESCE(SUM(total_due - amount_paid), 0) AS outstanding, COUNT(*) AS cnt
     FROM sales WHERE channel = 'order' AND status = 'completed' AND payment_status <> 'paid'`
  );

  return {
    total: Number(summary.cnt),
    page: safePage,
    limit: safeLimit,
    summary: {
      totalDue: new Decimal(summary.total_due).toFixed(0),
      outstanding: new Decimal(summary.outstanding).toFixed(0),
    },
    receivable: {
      outstanding: new Decimal(receivable.outstanding).toFixed(0),
      count: Number(receivable.cnt),
    },
    orders: rows.map(formatOrderRow),
  };
}

async function getInvoiceSettings() {
  const s = await StoreSettingsService.getSettings();
  return {
    storeName: s.store_name,
    storeAddress: s.store_address,
    storePhone: s.store_phone,
    bankInfo: s.invoice_bank_info,
    signerName: s.invoice_signer_name,
    footerNote: s.invoice_footer_note,
    logo: s.invoice_logo,
  };
}

async function getOrderDetail(saleId) {
  const [[row]] = await pool.query(
    `SELECT s.*, u.full_name AS created_by_name, vu.full_name AS voided_by_name,
            (SELECT COUNT(*) FROM sale_items pi WHERE pi.sale_id = s.id AND pi.fulfillment_status = 'pending') AS pending_item_count
     FROM sales s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN users vu ON vu.id = s.voided_by
     WHERE s.id = ? AND s.channel = 'order'`,
    [saleId]
  );
  if (!row) throw new HttpError(404, 'order_not_found', 'Invoice tidak ditemukan');

  const [items] = await pool.query(
    `SELECT si.*, p.name AS product_name, p.sku, u.name AS unit_name
     FROM sale_items si
     JOIN products p ON p.id = si.product_id
     JOIN units u ON u.id = si.unit_id
     WHERE si.sale_id = ?
     ORDER BY COALESCE(si.line_no, 999999) ASC, si.is_bonus ASC, si.created_at ASC, si.id ASC`,
    [saleId]
  );
  const [payments] = await pool.query(
    `SELECT sp.*, cu.full_name AS created_by_name, vu.full_name AS voided_by_name
     FROM sale_payments sp
     LEFT JOIN users cu ON cu.id = sp.created_by
     LEFT JOIN users vu ON vu.id = sp.voided_by
     WHERE sp.sale_id = ?
     ORDER BY sp.created_at ASC`,
    [saleId]
  );

  return {
    ...formatOrderRow(row),
    shippingAddress: row.shipping_address,
    notes: row.notes,
    subtotal: new Decimal(row.subtotal).toFixed(0),
    discountTotal: new Decimal(row.discount_total).toFixed(0),
    dpp: new Decimal(row.dpp).toFixed(0),
    ppnRate: row.ppn_rate,
    ppnMode: row.ppn_mode,
    ppnAmount: new Decimal(row.ppn_amount).toFixed(0),
    totalCost: new Decimal(row.total_cost).toFixed(0),
    grossProfit: new Decimal(row.gross_profit).toFixed(0),
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    voidedByName: row.voided_by_name,
    items: items.map((it) => ({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      sku: it.sku,
      unitName: it.unit_name,
      quantity: new Decimal(it.quantity).toFixed(4),
      sellingPrice: new Decimal(it.selling_price).toFixed(0),
      discountAmount: new Decimal(it.discount_amount).toFixed(0),
      subtotal: new Decimal(it.subtotal).toFixed(0),
      isBonus: !!it.is_bonus,
      bvPoints: new Decimal(it.bv_points || 0).toFixed(2),
      fulfillmentStatus: it.fulfillment_status,
      fulfilledAt: it.fulfilled_at,
      bundleId: it.bundle_id,
      bundleGroup: it.bundle_group,
      bundleName: it.bundle_name,
      bundleQty: it.bundle_qty === null ? null : new Decimal(it.bundle_qty).toFixed(4),
      bundlePrice: it.bundle_price === null ? null : new Decimal(it.bundle_price).toFixed(0),
    })),
    payments: payments.map((p) => ({
      id: p.id,
      paymentMethodName: p.payment_method_name,
      amount: new Decimal(p.amount).toFixed(0),
      paymentDate: toDateStr(p.payment_date),
      notes: p.notes,
      status: p.status,
      createdAt: p.created_at,
      createdByName: p.created_by_name,
      voidedAt: p.voided_at,
      voidedByName: p.voided_by_name,
      voidReason: p.void_reason,
    })),
    invoiceSettings: await getInvoiceSettings(),
  };
}

// Daftar cara kirim utk saran isian — bawaan + yang pernah dipakai.
async function listShippingMethods() {
  const [rows] = await pool.query(
    `SELECT shipping_method AS m, COUNT(*) AS cnt FROM sales
     WHERE channel = 'order' AND shipping_method IS NOT NULL
     GROUP BY shipping_method ORDER BY cnt DESC LIMIT 30`
  );
  const seen = new Set();
  const result = [];
  for (const m of [...rows.map((r) => r.m), ...DEFAULT_SHIPPING_METHODS]) {
    const key = m.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(m);
  }
  return result;
}

module.exports = {
  previewOrder,
  createOrder,
  recordPayment,
  voidPayment,
  updateShipping,
  voidOrder,
  fulfillIndent,
  listOrders,
  getOrderDetail,
  listShippingMethods,
};
