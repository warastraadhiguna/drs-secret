const express = require('express');
const OrderService = require('../services/OrderService');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// GET /api/admin/orders?q=&paymentStatus=unpaid|partial|paid|outstanding&shippingStatus=pending|shipped
//                      &status=completed|voided|all&startDate=&endDate=&page=&limit=
router.get(
  '/',
  requirePermission('orders', 'view'),
  asyncHandler(async (req, res) => {
    const { q, paymentStatus, shippingStatus, indent, status, startDate, endDate, page, limit } = req.query;
    const result = await OrderService.listOrders({ q, paymentStatus, shippingStatus, indent, status, startDate, endDate, page, limit });
    res.json(result);
  })
);

router.get(
  '/shipping-methods',
  requirePermission('orders', 'view'),
  asyncHandler(async (req, res) => {
    const methods = await OrderService.listShippingMethods();
    res.json({ methods });
  })
);

// POST /api/admin/orders/quote — preview invoice, tidak menyimpan apa pun.
// Body: { items: [{ productId, unitId, quantity, priceLevelId, isBonus?, discountType?, discountValue?, manualPrice? }],
//         totalDiscountType?, totalDiscountValue?, shippingFee? }
router.post(
  '/quote',
  requirePermission('orders', 'create'),
  asyncHandler(async (req, res) => {
    const { items, totalDiscountType, totalDiscountValue, shippingFee } = req.body;
    const quote = await OrderService.previewOrder({ items, totalDiscountType, totalDiscountValue, shippingFee });
    res.json({ quote });
  })
);

router.get(
  '/:id',
  requirePermission('orders', 'view'),
  asyncHandler(async (req, res) => {
    const order = await OrderService.getOrderDetail(req.params.id);
    res.json({ order });
  })
);

// POST /api/admin/orders — buat invoice. Body: { customerId, invoiceDate?, dueDate?, items, totalDiscountType?,
// totalDiscountValue?, shippingFee?, shippingMethod?, shippingAddress?, notes?,
// initialPayment?: { paymentMethodId, amount, paymentDate? }, belowCostReason? }
router.post(
  '/',
  requirePermission('orders', 'create'),
  asyncHandler(async (req, res) => {
    const order = await OrderService.createOrder({ ...req.body, userId: req.user.id, userRole: req.user.role });
    res.status(201).json({ order });
  })
);

// POST /api/admin/orders/:id/payments — body: { paymentMethodId, amount, paymentDate?, notes? }
router.post(
  '/:id/payments',
  requirePermission('orders', 'edit'),
  asyncHandler(async (req, res) => {
    const { paymentMethodId, amount, paymentDate, notes } = req.body;
    const order = await OrderService.recordPayment(req.params.id, { paymentMethodId, amount, paymentDate, notes, userId: req.user.id });
    res.status(201).json({ order });
  })
);

// POST /api/admin/orders/:id/payments/:paymentId/void — body: { reason }
router.post(
  '/:id/payments/:paymentId/void',
  requirePermission('orders', 'void'),
  asyncHandler(async (req, res) => {
    const order = await OrderService.voidPayment(req.params.id, req.params.paymentId, { reason: req.body.reason, userId: req.user.id });
    res.json({ order });
  })
);

// PUT /api/admin/orders/:id/shipping — body: { shippingMethod?, trackingNumber?, shippingAddress?, shippingStatus? }
router.put(
  '/:id/shipping',
  requirePermission('orders', 'edit'),
  asyncHandler(async (req, res) => {
    const { shippingMethod, trackingNumber, shippingAddress, shippingStatus } = req.body;
    const order = await OrderService.updateShipping(req.params.id, {
      shippingMethod, trackingNumber, shippingAddress, shippingStatus, userId: req.user.id,
    });
    res.json({ order });
  })
);

// POST /api/admin/orders/:id/fulfill — penuhi barang indent. body: { itemIds? } (kosong = semua)
router.post(
  '/:id/fulfill',
  requirePermission('orders', 'edit'),
  asyncHandler(async (req, res) => {
    const order = await OrderService.fulfillIndent(req.params.id, { itemIds: req.body.itemIds, userId: req.user.id });
    res.json({ order });
  })
);

// POST /api/admin/orders/:id/void — body: { reason }
router.post(
  '/:id/void',
  requirePermission('orders', 'void'),
  asyncHandler(async (req, res) => {
    const order = await OrderService.voidOrder(req.params.id, { reason: req.body.reason, userId: req.user.id });
    res.json({ order });
  })
);

module.exports = router;
