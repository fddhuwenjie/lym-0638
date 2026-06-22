const dayjs = require('dayjs');

const RECEIPT_STATUS = {
  PENDING: 'pending',
  PARTIAL: 'partial',
  CLAIMED: 'claimed',
  HANGING: 'hanging',
  CLOSED: 'closed'
};

const RECEIVABLE_STATUS = {
  UNPAID: 'unpaid',
  PARTIAL: 'partial',
  PAID: 'paid'
};

const HANGING_STATUS = {
  PENDING: 'pending',
  PROCESSED: 'processed',
  REJECTED: 'rejected'
};

const CLAIM_ERRORS = {
  DUPLICATE: '同一回单不能重复认领同一应收单',
  OVER_AMOUNT: '认领金额超过回单剩余可认领金额',
  OVER_RECEIVABLE: '认领金额超过应收单剩余金额',
  CUSTOMER_MISMATCH: '客户不匹配',
  RECEIVABLE_PAID: '应收单已结清，不能再次认领',
  RECEIPT_CLOSED: '回单已关闭，不能认领',
  HANGING_UNPROCESSED: '存在未处理的异常挂账，不能关闭/结清'
};

function validateClaimInput({ receipt, receivable, amount, existingClaims, sameReceivableClaims }) {
  if (receipt.status === RECEIPT_STATUS.CLOSED) {
    return CLAIM_ERRORS.RECEIPT_CLOSED;
  }
  if (receivable.status === RECEIVABLE_STATUS.PAID) {
    return CLAIM_ERRORS.RECEIVABLE_PAID;
  }
  if (receipt.customerId && receivable.customerId && receipt.customerId !== receivable.customerId) {
    return CLAIM_ERRORS.CUSTOMER_MISMATCH;
  }
  if (sameReceivableClaims && sameReceivableClaims.length > 0) {
    return CLAIM_ERRORS.DUPLICATE;
  }
  const claimedOnReceipt = existingClaims
    .filter(c => c.receiptId === receipt.id && c.status === 'active')
    .reduce((s, c) => s + Number(c.amount), 0);
  const receiptRemaining = Number(receipt.amount) - claimedOnReceipt;
  if (Number(amount) > receiptRemaining) {
    return CLAIM_ERRORS.OVER_AMOUNT;
  }
  const claimedOnReceivable = existingClaims
    .filter(c => c.receivableId === receivable.id && c.status === 'active')
    .reduce((s, c) => s + Number(c.amount), 0);
  const receivableRemaining = Number(receivable.amount) - claimedOnReceivable;
  if (Number(amount) > receivableRemaining) {
    return CLAIM_ERRORS.OVER_RECEIVABLE;
  }
  return null;
}

function computeReceiptStatus(receipt, claims) {
  const claimed = claims
    .filter(c => c.receiptId === receipt.id && c.status === 'active')
    .reduce((s, c) => s + Number(c.amount), 0);
  if (claimed === 0) return receipt.status === RECEIPT_STATUS.HANGING ? RECEIPT_STATUS.HANGING : RECEIPT_STATUS.PENDING;
  if (claimed < Number(receipt.amount)) return RECEIPT_STATUS.PARTIAL;
  return RECEIPT_STATUS.CLAIMED;
}

function computeReceivableStatus(receivable, claims) {
  const claimed = claims
    .filter(c => c.receivableId === receivable.id && c.status === 'active')
    .reduce((s, c) => s + Number(c.amount), 0);
  if (claimed === 0) return RECEIVABLE_STATUS.UNPAID;
  if (claimed < Number(receivable.amount)) return RECEIVABLE_STATUS.PARTIAL;
  return RECEIVABLE_STATUS.PAID;
}

function receiptNo(batchNo, index) {
  return `${batchNo}-${String(index).padStart(4, '0')}`;
}

function now() {
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

module.exports = {
  RECEIPT_STATUS,
  RECEIVABLE_STATUS,
  HANGING_STATUS,
  CLAIM_ERRORS,
  validateClaimInput,
  computeReceiptStatus,
  computeReceivableStatus,
  receiptNo,
  now
};
