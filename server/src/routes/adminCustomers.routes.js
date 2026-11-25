const express = require('express');
const CustomerService = require('../services/CustomerService');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// GET /api/admin/customers?q=&includeInactive=1&page=&limit=
router.get(
  '/',
  requirePermission('customers', 'view'),
  asyncHandler(async (req, res) => {
    const result = await CustomerService.listCustomers({
      q: req.query.q,
      includeInactive: req.query.includeInactive === '1',
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  })
);

router.get(
  '/:id',
  requirePermission('customers', 'view'),
  asyncHandler(async (req, res) => {
    const customer = await CustomerService.getCustomerDetail(req.params.id);
    res.json({ customer });
  })
);

// POST /api/admin/customers — body: { name, phone?, city?, address?, notes? }
router.post(
  '/',
  requirePermission('customers', 'create'),
  asyncHandler(async (req, res) => {
    const { name, phone, city, address, notes } = req.body;
    const customer = await CustomerService.createCustomer({ name, phone, city, address, notes, userId: req.user.id });
    res.status(201).json({ customer });
  })
);

// PUT /api/admin/customers/:id — partial: { name?, phone?, city?, address?, notes?, isActive? }
router.put(
  '/:id',
  requirePermission('customers', 'edit'),
  asyncHandler(async (req, res) => {
    const { name, phone, city, address, notes, isActive } = req.body;
    const customer = await CustomerService.updateCustomer(req.params.id, { name, phone, city, address, notes, isActive });
    res.json({ customer });
  })
);

module.exports = router;
