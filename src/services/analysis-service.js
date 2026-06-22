const JsonStore = require('../store/json-store');
const {
  BASE_CURRENCY, EXCHANGE_DIFF_STATUS, EXCHANGE_DIFF_TYPE,
  RECEIVABLE_STATUS, HANGING_STATUS, now
} = require('../utils/constants');
const path = require('path');

class AnalysisService {
  constructor() {
    this.store = new JsonStore(path.join(__dirname, '..', '..', 'data'));
  }

  _loadAll() {
    return {
      receipts: this.store.getAll('receipts'),
      receivables: this.store.getAll('receivables'),
      claims: this.store.getAll('claims'),
      hangings: this.store.getAll('hangings'),
      exchangeDiffs: this.store.getAll('exchangeDiffs'),
      exchangeRates: this.store.getAll('exchangeRates')
    };
  }

  _buildFilterPredicate(filters) {
    return (claim, data) => {
      const receipt = data.receipts.find(r => r.id === claim.receiptId);
      const receivable = data.receivables.find(r => r.id === claim.receivableId);
      if (!receipt || !receivable) return false;

      if (filters.customerId && receipt.customerId !== filters.customerId) return false;
      if (filters.receiptCurrency && (receipt.receiptCurrency || receipt.currency || BASE_CURRENCY) !== filters.receiptCurrency) return false;
      if (filters.receivableCurrency && (receivable.currency || BASE_CURRENCY) !== filters.receivableCurrency) return false;
      if (filters.settlementCurrency && (receipt.settlementCurrency || receipt.receiptCurrency || receipt.currency || BASE_CURRENCY) !== filters.settlementCurrency) return false;

      if (filters.startDate && claim.createdAt < filters.startDate) return false;
      if (filters.endDate && claim.createdAt > filters.endDate + ' 23:59:59') return false;

      if (filters.diffStatus) {
        const diff = data.exchangeDiffs.find(d => d.claimId === claim.id);
        if (!diff || diff.status !== filters.diffStatus) return false;
      }

      if (filters.hangingStatus) {
        const hanging = data.hangings.find(h => h.receiptId === claim.receiptId && h.status === filters.hangingStatus);
        if (filters.hangingStatus === HANGING_STATUS.PENDING && !hanging) return false;
        if (filters.hangingStatus === HANGING_STATUS.PROCESSED) {
          if (!hanging) return false;
        }
      }

      return true;
    };
  }

  _filterClaims(data, filters) {
    const predicate = this._buildFilterPredicate(filters);
    return data.claims.filter(c => c.status === 'active' && predicate(c, data));
  }

  getOverview(filters = {}) {
    const data = this._loadAll();
    const claims = this._filterClaims(data, filters);
    const receipts = data.receipts;
    const receivables = data.receivables;
    const exchangeDiffs = data.exchangeDiffs;

    let crossCurrencyClaimTotal = 0;
    let baseCurrencyClaimTotal = 0;
    let unprocessedDiffAmount = 0;
    let confirmedGain = 0;
    let confirmedLoss = 0;

    const customerSet = new Set();
    const receivableIds = new Set();
    const partialReceivableIds = new Set();
    const paidReceivableIds = new Set();

    claims.forEach(claim => {
      const receipt = receipts.find(r => r.id === claim.receiptId);
      const receivable = receivables.find(r => r.id === claim.receivableId);
      const receiptCurrency = receipt ? (receipt.receiptCurrency || receipt.currency || BASE_CURRENCY) : BASE_CURRENCY;
      const receivableCurrency = receivable ? (receivable.currency || BASE_CURRENCY) : BASE_CURRENCY;

      if (receiptCurrency !== receivableCurrency) {
        crossCurrencyClaimTotal += Number(claim.amount);
      }

      baseCurrencyClaimTotal += Number(claim.baseAmount || claim.amount);

      if (receipt) customerSet.add(receipt.customerId || receipt.customerName);

      const diff = exchangeDiffs.find(d => d.claimId === claim.id);
      if (diff) {
        if (diff.status === EXCHANGE_DIFF_STATUS.PENDING) {
          unprocessedDiffAmount += Number(diff.diffAmount);
        } else if (diff.status === EXCHANGE_DIFF_STATUS.PROCESSED) {
          const diffNum = Number(diff.diffAmount);
          if (diffNum > 0) confirmedGain += diffNum;
          if (diffNum < 0) confirmedLoss += diffNum;
        }
      }

      if (receivable) {
        receivableIds.add(receivable.id);
        const allClaimedBase = data.claims
          .filter(c => c.receivableId === receivable.id && c.status === 'active')
          .reduce((s, c) => s + Number(c.baseAmount || c.amount), 0);
        const receivableBase = Number(receivable.baseAmount || receivable.amount);
        if (allClaimedBase >= receivableBase - 0.01) {
          paidReceivableIds.add(receivable.id);
        } else if (allClaimedBase > 0) {
          partialReceivableIds.add(receivable.id);
        }
      }
    });

    let abnormalHangingCount = 0;
    const hangingFilterReceipts = new Set();
    claims.forEach(c => {
      if (c.receiptId) hangingFilterReceipts.add(c.receiptId);
    });
    data.hangings.forEach(h => {
      if (hangingFilterReceipts.has(h.receiptId) && h.status === HANGING_STATUS.PENDING) {
        abnormalHangingCount++;
      }
    });

    return {
      crossCurrencyClaimTotal: crossCurrencyClaimTotal.toFixed(2),
      baseCurrencyClaimTotal: baseCurrencyClaimTotal.toFixed(2),
      unprocessedDiffAmount: unprocessedDiffAmount.toFixed(2),
      confirmedGain: confirmedGain.toFixed(2),
      confirmedLoss: confirmedLoss.toFixed(2),
      abnormalHangingCount,
      partialReceivableCount: partialReceivableIds.size,
      settledReceivableCount: paidReceivableIds.size,
      totalClaimCount: claims.length,
      customerCount: customerSet.size
    };
  }

  getCustomerRanking(filters = {}) {
    const data = this._loadAll();
    const claims = this._filterClaims(data, filters);
    const receipts = data.receipts;
    const receivables = data.receivables;
    const exchangeDiffs = data.exchangeDiffs;

    const customerMap = {};

    claims.forEach(claim => {
      const receipt = receipts.find(r => r.id === claim.receiptId);
      const receivable = receivables.find(r => r.id === claim.receivableId);
      if (!receipt) return;

      const key = receipt.customerId || receipt.customerName;
      if (!customerMap[key]) {
        customerMap[key] = {
          customerId: receipt.customerId || '',
          customerName: receipt.customerName || '未知客户',
          claimCount: 0,
          crossCurrencyTotal: 0,
          baseCurrencyTotal: 0,
          diffAmount: 0,
          pendingDiffCount: 0
        };
      }

      const c = customerMap[key];
      c.claimCount++;
      const receiptCurrency = receipt.receiptCurrency || receipt.currency || BASE_CURRENCY;
      const receivableCurrency = receivable ? (receivable.currency || BASE_CURRENCY) : BASE_CURRENCY;
      if (receiptCurrency !== receivableCurrency) {
        c.crossCurrencyTotal += Number(claim.amount);
      }
      c.baseCurrencyTotal += Number(claim.baseAmount || claim.amount);

      const diff = exchangeDiffs.find(d => d.claimId === claim.id);
      if (diff) {
        c.diffAmount += Number(diff.diffAmount);
        if (diff.status === EXCHANGE_DIFF_STATUS.PENDING) {
          c.pendingDiffCount++;
        }
      }
    });

    return Object.values(customerMap)
      .map(c => ({
        ...c,
        crossCurrencyTotal: c.crossCurrencyTotal.toFixed(2),
        baseCurrencyTotal: c.baseCurrencyTotal.toFixed(2),
        diffAmount: c.diffAmount.toFixed(2)
      }))
      .sort((a, b) => Number(b.baseCurrencyTotal) - Number(a.baseCurrencyTotal));
  }

  getCurrencyDistribution(filters = {}) {
    const data = this._loadAll();
    const claims = this._filterClaims(data, filters);
    const receipts = data.receipts;
    const receivables = data.receivables;

    const comboMap = {};

    claims.forEach(claim => {
      const receipt = receipts.find(r => r.id === claim.receiptId);
      const receivable = receivables.find(r => r.id === claim.receivableId);
      const receiptCurrency = receipt ? (receipt.receiptCurrency || receipt.currency || BASE_CURRENCY) : BASE_CURRENCY;
      const receivableCurrency = receivable ? (receivable.currency || BASE_CURRENCY) : BASE_CURRENCY;
      const settlementCurrency = receipt ? (receipt.settlementCurrency || receipt.receiptCurrency || receipt.currency || BASE_CURRENCY) : BASE_CURRENCY;

      const key = `${receiptCurrency}->${receivableCurrency}`;
      if (!comboMap[key]) {
        comboMap[key] = {
          receiptCurrency,
          receivableCurrency,
          settlementCurrency,
          claimCount: 0,
          originalAmount: 0,
          baseAmount: 0
        };
      }

      comboMap[key].claimCount++;
      comboMap[key].originalAmount += Number(claim.amount);
      comboMap[key].baseAmount += Number(claim.baseAmount || claim.amount);
    });

    return Object.values(comboMap)
      .map(c => ({
        ...c,
        originalAmount: c.originalAmount.toFixed(2),
        baseAmount: c.baseAmount.toFixed(2)
      }))
      .sort((a, b) => Number(b.baseAmount) - Number(a.baseAmount));
  }

  getDailyDiffTrend(filters = {}) {
    const data = this._loadAll();
    const claims = this._filterClaims(data, filters);
    const exchangeDiffs = data.exchangeDiffs;

    const dailyMap = {};

    claims.forEach(claim => {
      const diff = exchangeDiffs.find(d => d.claimId === claim.id);
      if (!diff) return;

      const date = claim.createdAt.slice(0, 10);
      if (!dailyMap[date]) {
        dailyMap[date] = {
          date,
          diffCount: 0,
          totalDiffAmount: 0,
          gainAmount: 0,
          lossAmount: 0,
          pendingCount: 0,
          processedCount: 0
        };
      }

      const d = dailyMap[date];
      d.diffCount++;
      const diffNum = Number(diff.diffAmount);
      d.totalDiffAmount += diffNum;
      if (diffNum > 0) d.gainAmount += diffNum;
      if (diffNum < 0) d.lossAmount += diffNum;
      if (diff.status === EXCHANGE_DIFF_STATUS.PENDING) d.pendingCount++;
      if (diff.status === EXCHANGE_DIFF_STATUS.PROCESSED) d.processedCount++;
    });

    return Object.values(dailyMap)
      .map(d => ({
        ...d,
        totalDiffAmount: d.totalDiffAmount.toFixed(2),
        gainAmount: d.gainAmount.toFixed(2),
        lossAmount: d.lossAmount.toFixed(2)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  getHangingDetails(filters = {}) {
    const data = this._loadAll();
    const claims = this._filterClaims(data, filters);
    const filteredReceiptIds = new Set(claims.map(c => c.receiptId));

    let hangings = data.hangings;
    if (filters.hangingStatus) {
      hangings = hangings.filter(h => h.status === filters.hangingStatus);
    }

    const receipts = data.receipts;

    return hangings
      .filter(h => filteredReceiptIds.has(h.receiptId))
      .map(h => {
        const receipt = receipts.find(r => r.id === h.receiptId);
        return {
          hangingId: h.hangingId,
          receiptNo: receipt ? receipt.receiptNo : '',
          batchNo: receipt ? receipt.batchNo : '',
          customerName: receipt ? receipt.customerName : '',
          receiptAmount: receipt ? receipt.amount : '',
          receiptCurrency: receipt ? (receipt.receiptCurrency || receipt.currency || BASE_CURRENCY) : '',
          baseAmount: receipt ? receipt.baseAmount : '',
          reason: h.reason,
          status: h.status,
          createdBy: h.createdBy,
          createdAt: h.createdAt,
          processedBy: h.processedBy,
          processedAt: h.processedAt,
          processResult: h.processResult,
          processRemark: h.processRemark
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getCustomerClaimDetails(customerId, filters = {}) {
    const data = this._loadAll();
    const allClaims = data.claims.filter(c => c.status === 'active');
    const receipts = data.receipts;
    const receivables = data.receivables;
    const exchangeDiffs = data.exchangeDiffs;

    const predicate = this._buildFilterPredicate(filters);

    return allClaims
      .filter(claim => {
        const receipt = receipts.find(r => r.id === claim.receiptId);
        if (!receipt) return false;
        if (receipt.customerId !== customerId && receipt.customerName !== customerId) return false;
        return predicate(claim, data);
      })
      .map(claim => {
        const receipt = receipts.find(r => r.id === claim.receiptId);
        const receivable = receivables.find(r => r.id === claim.receivableId);
        const diff = exchangeDiffs.find(d => d.claimId === claim.id);

        const receiptCurrency = receipt ? (receipt.receiptCurrency || receipt.currency || BASE_CURRENCY) : BASE_CURRENCY;
        const receivableCurrency = receivable ? (receivable.currency || BASE_CURRENCY) : BASE_CURRENCY;

        const receiptBaseAmount = receipt ? Number(receipt.baseAmount || receipt.amount) : 0;
        const claimBaseAmount = Number(claim.baseAmount || claim.amount);
        const remainingBaseAmount = receiptBaseAmount - claimBaseAmount;

        const receivableBaseAmount = receivable ? Number(receivable.baseAmount || receivable.amount) : 0;
        const allClaimedBase = data.claims
          .filter(c => c.receivableId === claim.receivableId && c.status === 'active')
          .reduce((s, c) => s + Number(c.baseAmount || c.amount), 0);

        return {
          claimId: claim.claimId,
          receiptNo: receipt ? receipt.receiptNo : '',
          receiptOriginalAmount: receipt ? receipt.amount : '',
          receiptCurrency,
          receiptBaseAmount: receipt ? receipt.baseAmount : '',
          receivableNo: receivable ? receivable.receivableNo : '',
          receivableOriginalAmount: receivable ? receivable.amount : '',
          receivableCurrency,
          receivableBaseAmount: receivable ? (receivable.baseAmount || receivable.amount) : '',
          exchangeRate: claim.exchangeRate,
          claimOriginalAmount: claim.amount,
          claimCurrency: claim.currency || receiptCurrency,
          claimBaseAmount: claim.baseAmount,
          remainingBaseAmount: remainingBaseAmount.toFixed(2),
          receivableRemainingBase: (receivableBaseAmount - allClaimedBase).toFixed(2),
          exchangeDiffAmount: diff ? diff.diffAmount : null,
          exchangeDiffType: diff ? diff.diffType : null,
          exchangeDiffStatus: diff ? diff.status : null,
          processedBy: diff ? diff.processedBy : null,
          processedAt: diff ? diff.processedAt : null,
          processResult: diff ? diff.processResult : null,
          processRemark: diff ? diff.processRemark : null,
          matchType: claim.matchType,
          claimType: claim.claimType,
          operator: claim.operator,
          createdAt: claim.createdAt
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  exportAnalysis(filters = {}) {
    const overview = this.getOverview(filters);
    const customerRanking = this.getCustomerRanking(filters);
    const currencyDistribution = this.getCurrencyDistribution(filters);
    const dailyTrend = this.getDailyDiffTrend(filters);
    const hangingDetails = this.getHangingDetails(filters);

    const filterSummary = {
      customerId: filters.customerId || '',
      receiptCurrency: filters.receiptCurrency || '',
      receivableCurrency: filters.receivableCurrency || '',
      settlementCurrency: filters.settlementCurrency || '',
      startDate: filters.startDate || '',
      endDate: filters.endDate || '',
      diffStatus: filters.diffStatus || '',
      hangingStatus: filters.hangingStatus || ''
    };

    const exportId = this.store.nextId('EA');
    const record = {
      id: exportId,
      exportId,
      type: 'analysis',
      filterSummary,
      overview,
      customerRanking,
      currencyDistribution,
      dailyTrend,
      hangingDetails,
      operator: filters.operator || 'system',
      createdAt: now()
    };
    this.store.insert('exports', record);

    return {
      exportId,
      filterSummary,
      overview,
      customerRanking,
      currencyDistribution,
      dailyTrend,
      hangingDetails
    };
  }

  getFilterOptions() {
    const data = this._loadAll();
    const customers = new Map();
    const receiptCurrencies = new Set();
    const receivableCurrencies = new Set();
    const settlementCurrencies = new Set();

    data.receipts.forEach(r => {
      if (r.customerId || r.customerName) {
        customers.set(r.customerId || r.customerName, r.customerName || r.customerId);
      }
      const rc = r.receiptCurrency || r.currency || BASE_CURRENCY;
      receiptCurrencies.add(rc);
      if (r.settlementCurrency || r.receiptCurrency || r.currency) {
        settlementCurrencies.add(r.settlementCurrency || r.receiptCurrency || r.currency || BASE_CURRENCY);
      }
    });

    data.receivables.forEach(r => {
      receivableCurrencies.add(r.currency || BASE_CURRENCY);
    });

    return {
      customers: Array.from(customers.entries()).map(([id, name]) => ({ customerId: id, customerName: name })),
      receiptCurrencies: Array.from(receiptCurrencies).sort(),
      receivableCurrencies: Array.from(receivableCurrencies).sort(),
      settlementCurrencies: Array.from(settlementCurrencies).sort(),
      diffStatuses: [EXCHANGE_DIFF_STATUS.PENDING, EXCHANGE_DIFF_STATUS.PROCESSED],
      hangingStatuses: [HANGING_STATUS.PENDING, HANGING_STATUS.PROCESSED]
    };
  }
}

module.exports = AnalysisService;
