const express = require('express');
const SupplierPayableService = require('../services/SupplierPayableService');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// GET /api/admin/supplier-payables/summary — total utang per supplier
router.get(
  '/summary',
  requirePermission('supplier_payments', 'view'),
  asyncHandler(async (req, res) => {
    res.json(await SupplierPayableService.getSummary());
  })
);

// GET /api/admin/supplier-payables/purchases?supplierId=&status=outstanding|all
router.get(
  '/purchases',
  requirePermission('supplier_payments', 'view'),
  asyncHandler(async (req, res) => {
    const purchases = await SupplierPayableService.listPayablePurchases({
      supplierId: req.query.supplierId || undefined,
      status: req.query.status || 'outstanding',
    });
    res.json({ purchases });
  })
);

router.get(
  '/purchases/:id',
  requirePermission('supplier_payments', 'view'),
  asyncHandler(async (req, res) => {
    const purchase = await SupplierPayableService.getPurchasePayable(req.params.id);
    res.json({ purchase });
  })
);

// POST /api/admin/supplier-payables/purchases/:id/payments — { paymentDate?, method: cash|bank|return_credit, amount, notes? }
router.post(
  '/purchases/:id/payments',
  requirePermission('supplier_payments', 'create'),
  asyncHandler(async (req, res) => {
    const { paymentDate, method, amount, notes } = req.body;
    const purchase = await SupplierPayableService.recordPayment({
      purchaseId: req.params.id, paymentDate, method, amount, notes, userId: req.user.id,
    });
    res.status(201).json({ purchase });
  })
);

// POST /api/admin/supplier-payables/payments/:paymentId/void — { reason }
router.post(
  '/payments/:paymentId/void',
  requirePermission('supplier_payments', 'void'),
  asyncHandler(async (req, res) => {
    const purchase = await SupplierPayableService.voidPayment({
      paymentId: req.params.paymentId, reason: req.body.reason, userId: req.user.id,
    });
    res.json({ purchase });
  })
);

module.exports = router;
