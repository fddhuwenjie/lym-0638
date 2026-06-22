const JsonStore = require('../store/json-store');
const {
  BASE_CURRENCY, EXCHANGE_RATE_SOURCE, EXCHANGE_DIFF_STATUS, EXCHANGE_DIFF_TYPE,
  RECEIPT_STATUS, RECEIVABLE_STATUS, HANGING_STATUS, CLAIM_ERRORS,
  validateClaimInput, validateExchangeRate, computeReceiptStatus, computeReceivableStatus,
  toBaseCurrency, calculateExchangeDiff, getExchangeDiffType,
  receiptNo, now
} = require('../utils/constants');
const path = require('path');

class ReceiptService {
  constructor() {
    this.store = new JsonStore(path.join(__dirname, '..', '..', 'data'));
  }

  createBatch({ operator, fileName, remark = '' }) {
    const batchNo = this.store.nextId('B');
    const batch = {
      id: batchNo,
      batchNo,
      operator,
      fileName,
      remark,
      receiptCount: 0,
      totalAmount: 0,
      claimedCount: 0,
      status: 'imported',
      createdAt: now()
    };
    return this.store.insert('batches', batch);
  }

  createExchangeRate({ fromCurrency, toCurrency, rate, effectiveDate, source = EXCHANGE_RATE_SOURCE.MANUAL, operator }) {
    if (!fromCurrency || !toCurrency) throw new Error('币种不能为空');
    if (!validateExchangeRate(rate)) throw new Error('汇率必须大于0');
    const rateId = this.store.nextId('X');
    const exchangeRate = {
      id: rateId,
      rateId,
      fromCurrency,
      toCurrency,
      rate: Number(rate).toFixed(4),
      effectiveDate: effectiveDate || now().slice(0, 10),
      source,
      operator,
      createdAt: now()
    };
    return this.store.insert('exchangeRates', exchangeRate);
  }

  getExchangeRates({ fromCurrency, toCurrency, effectiveDate } = {}) {
    let rates = this.store.getAll('exchangeRates');
    if (fromCurrency) rates = rates.filter(r => r.fromCurrency === fromCurrency);
    if (toCurrency) rates = rates.filter(r => r.toCurrency === toCurrency);
    if (effectiveDate) rates = rates.filter(r => r.effectiveDate <= effectiveDate);
    return rates.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.createdAt.localeCompare(a.createdAt));
  }

  findExchangeRate(fromCurrency, toCurrency, date = now().slice(0, 10)) {
    if (fromCurrency === toCurrency) return 1;
    const rates = this.getExchangeRates({ fromCurrency, toCurrency, effectiveDate: date });
    if (rates.length > 0) return Number(rates[0].rate);
    const reverse = this.getExchangeRates({ fromCurrency: toCurrency, toCurrency: fromCurrency, effectiveDate: date });
    if (reverse.length > 0) return (1 / Number(reverse[0].rate)).toFixed(4);
    return null;
  }

  importReceipts(batchNo, receiptList, operator, batchExchangeRate) {
    const batch = this.store.findById('batches', batchNo, 'batchNo');
    if (!batch) throw new Error('批次不存在');
    const receipts = [];
    let total = 0;
    let totalBase = 0;
    receiptList.forEach((r, i) => {
      const receiptId = this.store.nextId('R');
      const no = receiptNo(batchNo, i + 1);
      const receiptCurrency = r.receiptCurrency || r.currency || BASE_CURRENCY;
      const receivableCurrency = r.receivableCurrency || receiptCurrency;
      const settlementCurrency = r.settlementCurrency || receiptCurrency;
      const bankDate = r.bankDate || now().slice(0, 10);
      let exchangeRate = r.exchangeRate;
      if (!exchangeRate && batchExchangeRate) {
        exchangeRate = batchExchangeRate;
      }
      if (!exchangeRate && receiptCurrency !== BASE_CURRENCY) {
        exchangeRate = this.findExchangeRate(receiptCurrency, BASE_CURRENCY, bankDate);
        if (!exchangeRate) {
          throw new Error(`回单${i + 1}：${receiptCurrency} 汇率不存在，请先录入汇率或手工指定`);
        }
      }
      if (exchangeRate && receiptCurrency !== BASE_CURRENCY) {
        this.createExchangeRate({
          fromCurrency: receiptCurrency,
          toCurrency: BASE_CURRENCY,
          rate: exchangeRate,
          effectiveDate: bankDate,
          source: EXCHANGE_RATE_SOURCE.IMPORT,
          operator
        });
      }
      const baseAmount = receiptCurrency === BASE_CURRENCY
        ? Number(r.amount).toFixed(2)
        : toBaseCurrency(r.amount, exchangeRate, receiptCurrency);
      const receipt = {
        id: receiptId,
        receiptNo: no,
        batchNo,
        bankDate,
        customerId: r.customerId || '',
        customerName: r.customerName || '',
        amount: Number(r.amount).toFixed(2),
        currency: receiptCurrency,
        receiptCurrency,
        receivableCurrency,
        settlementCurrency,
        exchangeRate: exchangeRate ? Number(exchangeRate).toFixed(4) : null,
        baseAmount,
        orderNo: r.orderNo || '',
        remark: r.remark || '',
        status: RECEIPT_STATUS.PENDING,
        importedBy: operator,
        createdAt: now()
      };
      receipts.push(receipt);
      total += Number(receipt.amount);
      totalBase += Number(receipt.baseAmount);
    });
    receipts.forEach(r => this.store.insert('receipts', r));
    const updated = this.store.update('batches', batchNo, {
      receiptCount: receipts.length,
      totalAmount: total.toFixed(2),
      totalBaseAmount: totalBase.toFixed(2)
    }, 'batchNo');
    return { batch: updated, receipts };
  }

  _findMatch(receipt, receivables, claims) {
    const exactCustomer = receivables.filter(r => {
      if (receipt.customerId && r.customerId && r.customerId !== receipt.customerId) return false;
      if (receipt.customerName && r.customerName && r.customerName !== receipt.customerName) return false;
      return true;
    });
    const unpaid = exactCustomer.filter(r => {
      const st = computeReceivableStatus(r, claims);
      return st !== RECEIVABLE_STATUS.PAID;
    });
    const byOrder = unpaid.find(r => receipt.orderNo && r.orderNo && r.orderNo === receipt.orderNo);
    if (byOrder) {
      const claimed = claims.filter(c => c.receivableId === byOrder.id && c.status === 'active')
        .reduce((s, c) => s + Number(c.amount), 0);
      const remaining = Number(byOrder.amount) - claimed;
      if (Math.abs(remaining - Number(receipt.amount)) < 0.001) {
        return { receivable: byOrder, matchType: 'order_amount', score: 100 };
      }
    }
    const byAmount = unpaid.find(r => {
      const claimed = claims.filter(c => c.receivableId === r.id && c.status === 'active')
        .reduce((s, c) => s + Number(c.amount), 0);
      const remaining = Number(r.amount) - claimed;
      return Math.abs(remaining - Number(receipt.amount)) < 0.001;
    });
    if (byAmount) {
      return { receivable: byAmount, matchType: 'amount', score: 80 };
    }
    if (byOrder) {
      return { receivable: byOrder, matchType: 'order', score: 60 };
    }
    return null;
  }

  autoMatch(batchNo, operator) {
    const batch = this.store.findById('batches', batchNo, 'batchNo');
    if (!batch) throw new Error('批次不存在');
    const receipts = this.store.filter('receipts', r => r.batchNo === batchNo && r.status === RECEIPT_STATUS.PENDING);
    const receivables = this.store.getAll('receivables');
    const claims = this.store.getAll('claims');
    const results = [];
    receipts.forEach(receipt => {
      const match = this._findMatch(receipt, receivables, claims);
      if (match) {
        try {
          const { claim } = this._createClaimInternal({
            receiptId: receipt.id,
            receivableId: match.receivable.id,
            amount: Number(receipt.amount),
            operator,
            claimType: 'auto',
            matchType: match.matchType
          });
          results.push({ receiptNo: receipt.receiptNo, status: 'matched', claimId: claim.id });
        } catch (e) {
          this._createHangingInternal({
            receiptId: receipt.id,
            reason: `自动匹配失败：${e.message}`,
            operator
          });
          results.push({ receiptNo: receipt.receiptNo, status: 'hanging', reason: e.message });
        }
      } else {
        this._createHangingInternal({
          receiptId: receipt.id,
          reason: '未找到匹配的应收单（客户/金额/订单号均不匹配）',
          operator
        });
        results.push({ receiptNo: receipt.receiptNo, status: 'hanging', reason: '无匹配' });
      }
    });
    this.store.update('batches', batchNo, { status: 'auto_matched' }, 'batchNo');
    return results;
  }

  _refreshReceiptStatus(receiptId) {
    const receipt = this.store.findById('receipts', receiptId);
    if (!receipt) return;
    const claims = this.store.getAll('claims');
    const newStatus = computeReceiptStatus(receipt, claims);
    if (newStatus !== receipt.status) {
      this.store.update('receipts', receiptId, { status: newStatus });
    }
  }

  _refreshReceivableStatus(receivableId) {
    const receivable = this.store.findById('receivables', receivableId);
    if (!receivable) return;
    const claims = this.store.getAll('claims');
    const newStatus = computeReceivableStatus(receivable, claims);
    this.store.update('receivables', receivableId, { status: newStatus });
  }

  _refreshBatch(batchNo) {
    const receipts = this.store.filter('receipts', r => r.batchNo === batchNo);
    const claims = this.store.getAll('claims');
    const claimedCount = receipts.filter(r => {
      const s = computeReceiptStatus(r, claims);
      return s === RECEIPT_STATUS.CLAIMED || s === RECEIPT_STATUS.PARTIAL || s === RECEIPT_STATUS.CLOSED;
    }).length;
    this.store.update('batches', batchNo, { claimedCount }, 'batchNo');
  }

  _createExchangeDiffInternal({ claimId, receiptId, receivableId, expectedBaseAmount, actualBaseAmount, operator }) {
    const diffAmount = calculateExchangeDiff(expectedBaseAmount, actualBaseAmount);
    const diffType = getExchangeDiffType(diffAmount);
    if (diffType === EXCHANGE_DIFF_TYPE.NONE) return null;
    const diffId = this.store.nextId('D');
    const diff = {
      id: diffId,
      diffId,
      claimId,
      receiptId,
      receivableId,
      expectedBaseAmount: Number(expectedBaseAmount).toFixed(2),
      actualBaseAmount: Number(actualBaseAmount).toFixed(2),
      diffAmount,
      diffType,
      status: EXCHANGE_DIFF_STATUS.PENDING,
      createdBy: operator,
      createdAt: now(),
      processedBy: null,
      processedAt: null,
      processResult: null,
      processRemark: null
    };
    return this.store.insert('exchangeDiffs', diff);
  }

  _createClaimInternal({ receiptId, receivableId, amount, baseAmount, exchangeRate, operator, claimType = 'manual', matchType = '' }) {
    const receipt = this.store.findById('receipts', receiptId);
    const receivable = this.store.findById('receivables', receivableId);
    if (!receipt) throw new Error('回单不存在');
    if (!receivable) throw new Error('应收单不存在');
    const allClaims = this.store.getAll('claims');
    const sameReceivableClaims = allClaims.filter(c =>
      c.receiptId === receiptId && c.receivableId === receivableId && c.status === 'active'
    );
    const receiptCurrency = receipt.receiptCurrency || receipt.currency || BASE_CURRENCY;
    if (!exchangeRate && receiptCurrency !== BASE_CURRENCY) {
      exchangeRate = receipt.exchangeRate;
    }
    const err = validateClaimInput({
      receipt, receivable, amount, baseAmount, exchangeRate,
      existingClaims: allClaims, sameReceivableClaims
    });
    if (err) throw new Error(err);
    const finalExchangeRate = exchangeRate || 1;
    const calculatedBaseAmount = toBaseCurrency(amount, finalExchangeRate, receiptCurrency);
    const actualBaseAmount = baseAmount !== undefined && baseAmount !== null
      ? Number(baseAmount).toFixed(2)
      : calculatedBaseAmount;
    const claimId = this.store.nextId('C');
    const claim = {
      id: claimId,
      claimId,
      receiptId,
      receivableId,
      amount: Number(amount).toFixed(2),
      currency: receiptCurrency,
      exchangeRate: Number(finalExchangeRate).toFixed(4),
      baseAmount: actualBaseAmount,
      operator,
      claimType,
      matchType,
      status: 'active',
      createdAt: now(),
      revokedAt: null,
      revokedBy: null,
      revokeReason: null
    };
    this.store.insert('claims', claim);
    const exchangeDiff = this._createExchangeDiffInternal({
      claimId,
      receiptId,
      receivableId,
      expectedBaseAmount: Number(calculatedBaseAmount),
      actualBaseAmount: Number(actualBaseAmount),
      operator
    });
    if (exchangeDiff) {
      this.store.update('claims', claimId, { exchangeDiffId: exchangeDiff.diffId });
    }
    this._refreshReceiptStatus(receiptId);
    this._refreshReceivableStatus(receivableId);
    this._refreshBatch(receipt.batchNo);
    return { claim, exchangeDiff };
  }

  _createHangingInternal({ receiptId, reason, operator }) {
    const existing = this.store.filter('hangings', h => h.receiptId === receiptId && h.status === HANGING_STATUS.PENDING);
    if (existing.length > 0) return existing[0];
    const hangingId = this.store.nextId('H');
    const hanging = {
      id: hangingId,
      hangingId,
      receiptId,
      reason,
      status: HANGING_STATUS.PENDING,
      createdBy: operator,
      createdAt: now(),
      processedBy: null,
      processedAt: null,
      processResult: null,
      processRemark: null
    };
    this.store.insert('hangings', hanging);
    const receipt = this.store.findById('receipts', receiptId);
    if (receipt && receipt.status !== RECEIPT_STATUS.HANGING) {
      this.store.update('receipts', receiptId, { status: RECEIPT_STATUS.HANGING });
    }
    if (receipt) this._refreshBatch(receipt.batchNo);
    return hanging;
  }

  manualClaim({ receiptId, receivableId, amount, baseAmount, exchangeRate, operator, remark = '' }) {
    return this._createClaimInternal({
      receiptId, receivableId, amount, baseAmount, exchangeRate, operator,
      claimType: 'manual', matchType: remark
    });
  }

  splitClaim({ receiptId, splits, operator }) {
    if (!splits || splits.length < 2) throw new Error('拆分认领需要至少2条明细');
    const receipt = this.store.findById('receipts', receiptId);
    if (!receipt) throw new Error('回单不存在');
    const allClaims = this.store.getAll('claims');
    const claimed = allClaims
      .filter(c => c.receiptId === receiptId && c.status === 'active')
      .reduce((s, c) => s + Number(c.amount), 0);
    const remaining = Number(receipt.amount) - claimed;
    const totalSplit = splits.reduce((s, sp) => s + Number(sp.amount), 0);
    if (Math.abs(totalSplit - remaining) > 0.001) {
      throw new Error(`拆分总金额 ${totalSplit.toFixed(2)} 与回单剩余金额 ${remaining.toFixed(2)} 不一致`);
    }
    const created = [];
    try {
      splits.forEach(sp => {
        const { claim } = this._createClaimInternal({
          receiptId, receivableId: sp.receivableId, amount: sp.amount,
          baseAmount: sp.baseAmount, exchangeRate: sp.exchangeRate,
          operator, claimType: 'split', matchType: sp.remark || ''
        });
        created.push(claim);
      });
    } catch (e) {
      created.forEach(c => this.revokeClaim(c.id, operator, '回滚拆分失败'));
      throw e;
    }
    return created;
  }

  revokeClaim(claimId, operator, reason = '') {
    const claim = this.store.findById('claims', claimId);
    if (!claim) throw new Error('认领记录不存在');
    if (claim.status !== 'active') throw new Error('该认领记录已被撤销');
    const receipt = this.store.findById('receipts', claim.receiptId);
    if (receipt && receipt.status === RECEIPT_STATUS.CLOSED) {
      throw new Error('回单已关闭，不能撤销认领');
    }
    this.store.update('claims', claimId, {
      status: 'revoked',
      revokedAt: now(),
      revokedBy: operator,
      revokeReason: reason
    });
    this._refreshReceiptStatus(claim.receiptId);
    this._refreshReceivableStatus(claim.receivableId);
    if (receipt) this._refreshBatch(receipt.batchNo);
    return this.store.findById('claims', claimId);
  }

  processHanging({ hangingId, action, receivableId, operator, amount, remark = '' }) {
    const hanging = this.store.findById('hangings', hangingId);
    if (!hanging) throw new Error('挂账记录不存在');
    if (hanging.status !== HANGING_STATUS.PENDING) throw new Error('该挂账已处理');
    const receipt = this.store.findById('receipts', hanging.receiptId);
    if (!receipt) throw new Error('关联回单不存在');
    let result = null;
    if (action === 'claim') {
      if (!receivableId) throw new Error('请选择应收单');
      const claimAmount = amount || Number(receipt.amount);
      const { claim } = this._createClaimInternal({
        receiptId: receipt.id, receivableId, amount: claimAmount,
        operator, claimType: 'hanging_resolve', matchType: remark
      });
      result = { action: 'claim', claimId: claim.id };
    } else if (action === 'reject') {
      result = { action: 'reject', remark };
    } else if (action === 'keep') {
      result = { action: 'keep', remark };
    } else {
      throw new Error('无效的处理动作');
    }
    const updated = this.store.update('hangings', hangingId, {
      status: HANGING_STATUS.PROCESSED,
      processedBy: operator,
      processedAt: now(),
      processResult: JSON.stringify(result),
      processRemark: remark
    });
    if (action !== 'keep') {
      const pending = this.store.filter('hangings', h =>
        h.receiptId === hanging.receiptId && h.status === HANGING_STATUS.PENDING
      );
      if (pending.length === 0) this._refreshReceiptStatus(hanging.receiptId);
    }
    this._refreshBatch(receipt.batchNo);
    return updated;
  }

  closeReceipt(receiptId, operator) {
    const receipt = this.store.findById('receipts', receiptId);
    if (!receipt) throw new Error('回单不存在');
    const pendingHanging = this.store.filter('hangings', h =>
      h.receiptId === receiptId && h.status === HANGING_STATUS.PENDING
    );
    if (pendingHanging.length > 0) {
      throw new Error(CLAIM_ERRORS.HANGING_UNPROCESSED);
    }
    this.store.update('receipts', receiptId, {
      status: RECEIPT_STATUS.CLOSED,
      closedBy: operator,
      closedAt: now()
    });
    this._refreshBatch(receipt.batchNo);
    return this.store.findById('receipts', receiptId);
  }

  closeBatch(batchNo, operator) {
    const batch = this.store.findById('batches', batchNo, 'batchNo');
    if (!batch) throw new Error('批次不存在');
    const receipts = this.store.filter('receipts', r => r.batchNo === batchNo);
    for (const r of receipts) {
      const pendingHanging = this.store.filter('hangings', h =>
        h.receiptId === r.id && h.status === HANGING_STATUS.PENDING
      );
      if (pendingHanging.length > 0) {
        throw new Error(`回单 ${r.receiptNo} 存在未处理挂账，不能关闭批次`);
      }
    }
    return this.store.update('batches', batchNo, {
      status: 'closed',
      closedBy: operator,
      closedAt: now()
    }, 'batchNo');
  }

  getExchangeDiffList({ status, diffType, batchNo } = {}) {
    const diffs = this.store.getAll('exchangeDiffs');
    const receipts = this.store.getAll('receipts');
    const receivables = this.store.getAll('receivables');
    const claims = this.store.getAll('claims');
    let list = diffs.map(d => {
      const rc = receipts.find(r => r.id === d.receiptId);
      const rv = receivables.find(r => r.id === d.receivableId);
      const cl = claims.find(c => c.id === d.claimId);
      return {
        diffId: d.diffId,
        claimId: d.claimId,
        receiptNo: rc ? rc.receiptNo : '',
        batchNo: rc ? rc.batchNo : '',
        receivableNo: rv ? rv.receivableNo : '',
        customerName: rc ? rc.customerName : '',
        expectedBaseAmount: d.expectedBaseAmount,
        actualBaseAmount: d.actualBaseAmount,
        diffAmount: d.diffAmount,
        diffType: d.diffType,
        status: d.status,
        createdBy: d.createdBy,
        createdAt: d.createdAt,
        processedBy: d.processedBy,
        processedAt: d.processedAt,
        processResult: d.processResult,
        processRemark: d.processRemark,
        receiptCurrency: rc ? rc.receiptCurrency : '',
        claimAmount: cl ? cl.amount : '',
        exchangeRate: cl ? cl.exchangeRate : ''
      };
    });
    if (status) list = list.filter(x => x.status === status);
    if (diffType) list = list.filter(x => x.diffType === diffType);
    if (batchNo) list = list.filter(x => x.batchNo === batchNo);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  processExchangeDiff({ diffId, action, operator, remark = '' }) {
    const diff = this.store.findById('exchangeDiffs', diffId, 'diffId');
    if (!diff) throw new Error('汇兑差异记录不存在');
    if (diff.status !== EXCHANGE_DIFF_STATUS.PENDING) throw new Error('该汇兑差异已处理');
    let result = null;
    if (action === 'recognize') {
      result = { action: 'recognize', description: `确认汇兑${diff.diffType === 'gain' ? '收益' : '损失'}` };
    } else if (action === 'writeoff') {
      result = { action: 'writeoff', description: '核销差异' };
    } else if (action === 'adjust') {
      result = { action: 'adjust', description: '调整入账' };
    } else {
      throw new Error('无效的处理动作');
    }
    return this.store.update('exchangeDiffs', diffId, {
      status: EXCHANGE_DIFF_STATUS.PROCESSED,
      processedBy: operator,
      processedAt: now(),
      processResult: JSON.stringify(result),
      processRemark: remark
    }, 'diffId');
  }

  createReceivable(data) {
    const id = this.store.nextId('A');
    const currency = data.currency || BASE_CURRENCY;
    let exchangeRate = data.exchangeRate;
    if (!exchangeRate && currency !== BASE_CURRENCY) {
      exchangeRate = this.findExchangeRate(currency, BASE_CURRENCY, now().slice(0, 10));
      if (!exchangeRate) {
        throw new Error(`${currency} 汇率不存在，请先录入汇率或手工指定`);
      }
    }
    const baseAmount = currency === BASE_CURRENCY
      ? Number(data.amount).toFixed(2)
      : toBaseCurrency(data.amount, exchangeRate, currency);
    const receivable = {
      id,
      receivableNo: data.receivableNo || id,
      customerId: data.customerId,
      customerName: data.customerName,
      orderNo: data.orderNo || '',
      contractNo: data.contractNo || '',
      amount: Number(data.amount).toFixed(2),
      currency,
      exchangeRate: exchangeRate ? Number(exchangeRate).toFixed(4) : null,
      baseAmount,
      dueDate: data.dueDate || '',
      remark: data.remark || '',
      status: RECEIVABLE_STATUS.UNPAID,
      createdBy: data.createdBy || 'system',
      createdAt: now()
    };
    return this.store.insert('receivables', receivable);
  }

  getClaimDetails({ batchNo, customerId, status } = {}) {
    const claims = this.store.getAll('claims');
    const receipts = this.store.getAll('receipts');
    const receivables = this.store.getAll('receivables');
    const batches = this.store.getAll('batches');
    const exchangeDiffs = this.store.getAll('exchangeDiffs');
    let list = claims.map(c => {
      const rc = receipts.find(r => r.id === c.receiptId);
      const rv = receivables.find(r => r.id === c.receivableId);
      const bc = batches.find(b => b.batchNo === (rc ? rc.batchNo : ''));
      const diff = exchangeDiffs.find(d => d.claimId === c.id);
      return {
        claimId: c.claimId,
        claimType: c.claimType,
        matchType: c.matchType,
        amount: c.amount,
        currency: c.currency || (rc ? rc.receiptCurrency : BASE_CURRENCY),
        exchangeRate: c.exchangeRate,
        baseAmount: c.baseAmount,
        operator: c.operator,
        status: c.status,
        createdAt: c.createdAt,
        receiptNo: rc ? rc.receiptNo : '',
        batchNo: rc ? rc.batchNo : '',
        bankDate: rc ? rc.bankDate : '',
        receiptCustomer: rc ? rc.customerName : '',
        receivableNo: rv ? rv.receivableNo : '',
        orderNo: rv ? rv.orderNo : '',
        receivableCustomer: rv ? rv.customerName : '',
        receivableAmount: rv ? rv.amount : '',
        receivableCurrency: rv ? rv.currency : BASE_CURRENCY,
        batchOperator: bc ? bc.operator : '',
        exchangeDiffId: c.exchangeDiffId,
        exchangeDiffAmount: diff ? diff.diffAmount : null,
        exchangeDiffType: diff ? diff.diffType : null,
        exchangeDiffStatus: diff ? diff.status : null,
        revokedAt: c.revokedAt,
        revokedBy: c.revokedBy,
        revokeReason: c.revokeReason
      };
    });
    if (batchNo) list = list.filter(x => x.batchNo === batchNo);
    if (customerId) {
      list = list.filter(x => {
        const rc = receipts.find(r => r.id === claims.find(c => c.claimId === x.claimId).receiptId);
        return rc && rc.customerId === customerId;
      });
    }
    if (status) list = list.filter(x => x.status === status);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getHangingList({ status, batchNo } = {}) {
    const hangings = this.store.getAll('hangings');
    const receipts = this.store.getAll('receipts');
    let list = hangings.map(h => {
      const rc = receipts.find(r => r.id === h.receiptId);
      return {
        hangingId: h.hangingId,
        receiptNo: rc ? rc.receiptNo : '',
        batchNo: rc ? rc.batchNo : '',
        receiptAmount: rc ? rc.amount : '',
        customerName: rc ? rc.customerName : '',
        orderNo: rc ? rc.orderNo : '',
        reason: h.reason,
        status: h.status,
        createdBy: h.createdBy,
        createdAt: h.createdAt,
        processedBy: h.processedBy,
        processedAt: h.processedAt,
        processResult: h.processResult,
        processRemark: h.processRemark
      };
    });
    if (status) list = list.filter(x => x.status === status);
    if (batchNo) list = list.filter(x => x.batchNo === batchNo);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getReceivableList({ status, customerId } = {}) {
    const receivables = this.store.getAll('receivables');
    const claims = this.store.getAll('claims');
    let list = receivables.map(r => {
      const claimed = claims
        .filter(c => c.receivableId === r.id && c.status === 'active')
        .reduce((s, c) => s + Number(c.amount), 0);
      const remaining = Number(r.amount) - claimed;
      return {
        receivableNo: r.receivableNo,
        customerId: r.customerId,
        customerName: r.customerName,
        orderNo: r.orderNo,
        contractNo: r.contractNo,
        amount: r.amount,
        currency: r.currency,
        exchangeRate: r.exchangeRate,
        baseAmount: r.baseAmount,
        claimedAmount: claimed.toFixed(2),
        remainingAmount: remaining.toFixed(2),
        dueDate: r.dueDate,
        status: r.status,
        createdAt: r.createdAt
      };
    });
    if (status) list = list.filter(x => x.status === status);
    if (customerId) list = list.filter(x => x.customerId === customerId);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getReceipts(batchNo) {
    const receipts = this.store.filter('receipts', r => r.batchNo === batchNo);
    const claims = this.store.getAll('claims');
    return receipts.map(r => {
      const claimed = claims
        .filter(c => c.receiptId === r.id && c.status === 'active')
        .reduce((s, c) => s + Number(c.amount), 0);
      const claimedBase = claims
        .filter(c => c.receiptId === r.id && c.status === 'active')
        .reduce((s, c) => s + Number(c.baseAmount || 0), 0);
      return {
        ...r,
        claimedAmount: claimed.toFixed(2),
        remainingAmount: (Number(r.amount) - claimed).toFixed(2),
        claimedBaseAmount: claimedBase.toFixed(2),
        remainingBaseAmount: (Number(r.baseAmount || r.amount) - claimedBase).toFixed(2)
      };
    });
  }

  getBatches() {
    return this.store.getAll('batches').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  exportReconciliation({ startDate, endDate, operator }) {
    const claims = this.getClaimDetails();
    const hangings = this.getHangingList();
    const receipts = this.store.getAll('receipts');
    const exchangeDiffs = this.getExchangeDiffList();
    const records = [];
    claims.forEach(c => {
      if (startDate && c.createdAt < startDate) return;
      if (endDate && c.createdAt > endDate + ' 23:59:59') return;
      const difference = [];
      const receipt = receipts.find(r => r.receiptNo === c.receiptNo);
      if (c.receiptCustomer !== c.receivableCustomer && c.receiptCustomer && c.receivableCustomer) {
        difference.push('客户名称不一致');
      }
      if (c.status === 'revoked') difference.push('认领已撤销');
      if (c.exchangeDiffType && c.exchangeDiffType !== 'none') {
        difference.push(`汇兑${c.exchangeDiffType === 'gain' ? '收益' : '损失'}`);
      }
      const diff = exchangeDiffs.find(d => d.claimId === c.claimId);
      records.push({
        type: '认领',
        batchNo: c.batchNo,
        receiptNo: c.receiptNo,
        bankDate: c.bankDate,
        receiptAmount: receipt ? receipt.amount : '',
        receiptCurrency: c.currency,
        receivableNo: c.receivableNo,
        orderNo: c.orderNo,
        claimAmount: c.amount,
        claimCurrency: c.currency,
        exchangeRate: c.exchangeRate,
        baseAmount: c.baseAmount,
        receivableAmount: c.receivableAmount,
        receivableCurrency: c.receivableCurrency,
        exchangeDiffAmount: c.exchangeDiffAmount,
        exchangeDiffType: c.exchangeDiffType,
        exchangeDiffStatus: c.exchangeDiffStatus,
        diffProcessedBy: diff ? diff.processedBy : '',
        diffProcessedAt: diff ? diff.processedAt : '',
        diffProcessResult: diff ? diff.processResult : '',
        diffProcessRemark: diff ? diff.processRemark : '',
        receiptCustomer: c.receiptCustomer,
        receivableCustomer: c.receivableCustomer,
        claimType: c.claimType,
        matchType: c.matchType,
        operator: c.operator,
        claimant: c.batchOperator,
        claimStatus: c.status,
        createdAt: c.createdAt,
        differenceReason: difference.join('; '),
        processResult: c.status === 'active' ? '认领成功' : `已撤销：${c.revokeReason || ''}`,
        revokedAt: c.revokedAt,
        revokedBy: c.revokedBy
      });
    });
    hangings.forEach(h => {
      if (startDate && h.createdAt < startDate) return;
      if (endDate && h.createdAt > endDate + ' 23:59:59') return;
      const receipt = receipts.find(r => r.receiptNo === h.receiptNo);
      records.push({
        type: '挂账',
        batchNo: h.batchNo,
        receiptNo: h.receiptNo,
        bankDate: receipt ? receipt.bankDate : '',
        receiptAmount: h.receiptAmount,
        receiptCurrency: receipt ? receipt.receiptCurrency : '',
        exchangeRate: receipt ? receipt.exchangeRate : '',
        baseAmount: receipt ? receipt.baseAmount : '',
        customerName: h.customerName,
        orderNo: h.orderNo,
        reason: h.reason,
        hangingStatus: h.status,
        createdBy: h.createdBy,
        createdAt: h.createdAt,
        processedBy: h.processedBy,
        processedAt: h.processedAt,
        differenceReason: h.reason,
        processResult: h.processRemark || h.processResult || ''
      });
    });
    const exportId = this.store.nextId('E');
    const record = {
      id: exportId,
      exportId,
      type: 'reconciliation',
      startDate,
      endDate,
      recordCount: records.length,
      operator,
      createdAt: now(),
      content: JSON.stringify(records)
    };
    this.store.insert('exports', record);
    return {
      exportId,
      recordCount: records.length,
      records
    };
  }

  getExportList() {
    return this.store.getAll('exports').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

module.exports = ReceiptService;
