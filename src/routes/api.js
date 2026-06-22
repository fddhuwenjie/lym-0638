const express = require('express');
const ReceiptService = require('../services/receipt-service');

const router = express.Router();
const service = new ReceiptService();

function wrap(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req);
      res.json({ code: 0, message: 'success', data: result });
    } catch (e) {
      res.status(400).json({ code: 1, message: e.message });
    }
  };
}

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

router.post('/batches', wrap(req => {
  const { operator, fileName, remark } = req.body;
  if (!operator) throw new Error('操作人必填');
  return service.createBatch({ operator, fileName: fileName || 'manual', remark });
}));

router.get('/batches', wrap(() => service.getBatches()));

router.post('/batches/:batchNo/import', wrap(req => {
  const { batchNo } = req.params;
  const { receipts, operator } = req.body;
  if (!operator) throw new Error('操作人必填');
  if (!receipts || !Array.isArray(receipts) || receipts.length === 0) {
    throw new Error('回单明细不能为空');
  }
  return service.importReceipts(batchNo, receipts, operator);
}));

router.get('/batches/:batchNo/receipts', wrap(req => {
  return service.getReceipts(req.params.batchNo);
}));

router.post('/batches/:batchNo/auto-match', wrap(req => {
  const { operator } = req.body;
  if (!operator) throw new Error('操作人必填');
  return service.autoMatch(req.params.batchNo, operator);
}));

router.post('/batches/:batchNo/close', wrap(req => {
  const { operator } = req.body;
  if (!operator) throw new Error('操作人必填');
  return service.closeBatch(req.params.batchNo, operator);
}));

router.post('/receivables', wrap(req => {
  return service.createReceivable(req.body);
}));

router.get('/receivables', wrap(req => {
  const { status, customerId } = req.query;
  return service.getReceivableList({ status, customerId });
}));

router.post('/claims/manual', wrap(req => {
  const { receiptId, receivableId, amount, operator, remark } = req.body;
  if (!receiptId || !receivableId || !amount || !operator) {
    throw new Error('回单、应收单、金额、操作人均必填');
  }
  return service.manualClaim({ receiptId, receivableId, amount, operator, remark });
}));

router.post('/claims/split', wrap(req => {
  const { receiptId, splits, operator } = req.body;
  if (!receiptId || !splits || !operator) throw new Error('参数不完整');
  return service.splitClaim({ receiptId, splits, operator });
}));

router.post('/claims/:claimId/revoke', wrap(req => {
  const { operator, reason } = req.body;
  if (!operator) throw new Error('操作人必填');
  return service.revokeClaim(req.params.claimId, operator, reason);
}));

router.get('/claims', wrap(req => {
  const { batchNo, customerId, status } = req.query;
  return service.getClaimDetails({ batchNo, customerId, status });
}));

router.get('/hangings', wrap(req => {
  const { status, batchNo } = req.query;
  return service.getHangingList({ status, batchNo });
}));

router.post('/hangings/:hangingId/process', wrap(req => {
  const { action, receivableId, operator, amount, remark } = req.body;
  if (!action || !operator) throw new Error('处理动作和操作人必填');
  return service.processHanging({
    hangingId: req.params.hangingId,
    action, receivableId, operator, amount, remark
  });
}));

router.post('/receipts/:receiptId/close', wrap(req => {
  const { operator } = req.body;
  if (!operator) throw new Error('操作人必填');
  return service.closeReceipt(req.params.receiptId, operator);
}));

router.post('/exports/reconciliation', wrap(req => {
  const { startDate, endDate, operator } = req.body;
  if (!operator) throw new Error('操作人必填');
  return service.exportReconciliation({ startDate, endDate, operator });
}));

router.get('/exports', wrap(() => service.getExportList()));

module.exports = router;
