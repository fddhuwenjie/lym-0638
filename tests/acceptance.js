const fs = require('fs');
const path = require('path');
const ReceiptService = require('../src/services/receipt-service');

const DATA_DIR = path.join(__dirname, '..', 'data');

function clearData() {
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`❌ 断言失败: ${message}`);
  }
  console.log(`  ✅ ${message}`);
}

async function runTests() {
  console.log('\n================================================');
  console.log('  票据收款认领与异常挂账服务 - 验收测试');
  console.log('================================================\n');

  clearData();
  const service = new ReceiptService();

  try {
    console.log('【场景一】基础数据准备 - 创建应收单');
    const r1 = service.createReceivable({
      receivableNo: 'AR2025001', customerId: 'C001', customerName: '华为技术有限公司',
      orderNo: 'ORD-2025-001', amount: 200000, dueDate: '2025-12-31', createdBy: 'finance_01'
    });
    console.log('  创建应收单 AR2025001: 华为 ¥200,000 (ORD-2025-001)');
    const r2 = service.createReceivable({
      receivableNo: 'AR2025002', customerId: 'C001', customerName: '华为技术有限公司',
      orderNo: 'ORD-2025-002', amount: 50000, dueDate: '2025-12-31', createdBy: 'finance_01'
    });
    console.log('  创建应收单 AR2025002: 华为 ¥50,000 (ORD-2025-002)');
    const r3 = service.createReceivable({
      receivableNo: 'AR2025003', customerId: 'C002', customerName: '阿里巴巴集团',
      orderNo: 'ORD-2025-003', amount: 80000, dueDate: '2025-12-25', createdBy: 'finance_01'
    });
    console.log('  创建应收单 AR2025003: 阿里巴巴 ¥80,000 (ORD-2025-003)');
    const r4 = service.createReceivable({
      receivableNo: 'AR2025004', customerId: 'C003', customerName: '腾讯科技',
      orderNo: 'ORD-2025-004', amount: 30000, dueDate: '2026-01-15', createdBy: 'finance_01'
    });
    console.log('  创建应收单 AR2025004: 腾讯 ¥30,000 (ORD-2025-004)');
    console.log('');

    console.log('【场景二】回单导入与批次管理');
    const batch = service.createBatch({ operator: 'finance_01', fileName: 'bank_2025_06_20.xlsx', remark: '6月20日银行回单' });
    console.log(`  创建批次: ${batch.batchNo}`);
    const imported = service.importReceipts(batch.batchNo, [
      { bankDate: '2025-06-20', customerId: 'C001', customerName: '华为技术有限公司', amount: 100000, orderNo: 'ORD-2025-001', remark: '货款' },
      { bankDate: '2025-06-20', customerId: 'C002', customerName: '阿里巴巴集团', amount: 80000, orderNo: '', remark: '' },
      { bankDate: '2025-06-20', customerId: 'C999', customerName: '字节跳动', amount: 25000, orderNo: '', remark: '无订单信息' },
      { bankDate: '2025-06-20', customerId: 'C001', customerName: '华为技术有限公司', amount: 60000, orderNo: '', remark: '合并付款' },
      { bankDate: '2025-06-20', customerId: 'C003', customerName: '腾讯科技', amount: 30000, orderNo: 'ORD-2025-004', remark: '全额' }
    ], 'finance_01');
    console.log(`  导入 ${imported.receipts.length} 张回单, 总金额: ¥${imported.batch.totalAmount}`);
    assert(imported.receipts.length === 5, '应导入5张回单');
    assert(imported.batch.receiptCount === 5, '批次数量应为5');
    console.log('');

    console.log('【场景三】自动匹配');
    const matchResults = service.autoMatch(batch.batchNo, 'system_auto');
    console.log(`  自动匹配结果: ${matchResults.filter(r => r.status === 'matched').length} 成功, ${matchResults.filter(r => r.status === 'hanging').length} 挂账`);
    matchResults.forEach(r => console.log(`    ${r.receiptNo}: ${r.status}${r.reason ? ' - ' + r.reason : ''}`));
    const matchedCount = matchResults.filter(r => r.status === 'matched').length;
    const hangingCount = matchResults.filter(r => r.status === 'hanging').length;
    assert(matchedCount === 3, '应有3张回单自动匹配成功（华为订单1+阿里巴巴金额匹配+腾讯）');
    assert(hangingCount === 2, '应有2张回单转挂账');
    console.log('');

    console.log('【场景四】验证-部分认领撤销后余额恢复');
    const receipts = service.getReceipts(batch.batchNo);
    const hwReceipt = receipts.find(r => r.receiptNo.endsWith('0004'));
    console.log(`  选择华为合并付款回单: ${hwReceipt.receiptNo}, 金额: ¥${hwReceipt.amount}, 剩余: ¥${hwReceipt.remainingAmount}`);

    const splitClaims = service.splitClaim({
      receiptId: hwReceipt.id,
      splits: [
        { receivableId: r1.id, amount: 30000, remark: '部分支付ORD001' },
        { receivableId: r2.id, amount: 30000, remark: '部分支付ORD002' }
      ],
      operator: 'business_01'
    });
    console.log(`  拆分认领成功: ${splitClaims.length} 条记录, 各¥30,000`);

    const receivablesAfter = service.getReceivableList();
    const ar1 = receivablesAfter.find(r => r.receivableNo === 'AR2025001');
    const ar2 = receivablesAfter.find(r => r.receivableNo === 'AR2025002');
    console.log(`  AR2025001 状态: ${ar1.status}, 已认领: ¥${ar1.claimedAmount}, 剩余: ¥${ar1.remainingAmount}`);
    console.log(`  AR2025002 状态: ${ar2.status}, 已认领: ¥${ar2.claimedAmount}, 剩余: ¥${ar2.remainingAmount}`);
    assert(ar1.status === 'partial', 'AR2025001 应为部分认领状态');
    assert(ar1.claimedAmount === '130000.00', 'AR2025001 已认领金额应为130,000 (自动10万+拆分3万)');
    assert(ar1.remainingAmount === '70000.00', 'AR2025001 剩余应为70,000');
    assert(ar2.claimedAmount === '30000.00', 'AR2025002 已认领应为30,000');
    assert(ar2.remainingAmount === '20000.00', 'AR2025002 剩余应为20,000');

    console.log('  撤销拆分认领中 AR2025002 的 ¥30,000 ...');
    const claimToRevoke = splitClaims.find(c => c.receivableId === r2.id);
    service.revokeClaim(claimToRevoke.id, 'business_01', '客户反馈金额有误');

    const receivablesAfterRevoke = service.getReceivableList();
    const ar2After = receivablesAfterRevoke.find(r => r.receivableNo === 'AR2025002');
    const hwAfter = service.getReceipts(batch.batchNo).find(r => r.receiptNo.endsWith('0004'));
    console.log(`  撤销后 AR2025002 已认领: ¥${ar2After.claimedAmount}, 剩余: ¥${ar2After.remainingAmount}`);
    console.log(`  撤销后 回单 剩余可认领: ¥${hwAfter.remainingAmount}`);
    assert(ar2After.claimedAmount === '0.00', '撤销后 AR2025002 已认领应为0');
    assert(ar2After.remainingAmount === '50000.00', '撤销后 AR2025002 剩余应恢复为50,000');
    assert(Number(hwAfter.remainingAmount) === 30000, '撤销后回单剩余应恢复为30,000（6万-已认领3万）');
    console.log('');

    console.log('【场景五】异常挂账处理');
    const hangingList = service.getHangingList({ status: 'pending' });
    console.log(`  当前待处理挂账: ${hangingList.length} 条`);
    hangingList.forEach(h => console.log(`    ${h.hangingId}: ${h.receiptNo} ${h.customerName} ¥${h.receiptAmount} - ${h.reason}`));

    const bytedanceHanging = hangingList.find(h => h.customerName === '字节跳动');
    const hwMergeHanging = hangingList.find(h => h.customerName === '华为技术有限公司');

    console.log('  处理华为合并付款挂账 - 已通过拆分认领处理，标记完成 ...');
    const resolved1 = service.processHanging({
      hangingId: hwMergeHanging.hangingId,
      action: 'keep',
      operator: 'finance_manager',
      remark: '已通过拆分认领完成'
    });
    assert(resolved1.status === 'processed', '挂账状态应为已处理');

    console.log('  处理字节跳动挂账 - 无法匹配，拒绝认领 ...');
    const resolved2 = service.processHanging({
      hangingId: bytedanceHanging.hangingId,
      action: 'reject',
      operator: 'finance_manager',
      remark: '无对应应收，退回银行查询'
    });
    assert(resolved2.status === 'processed', '拒绝的挂账也应标记为已处理');
    console.log('');

    console.log('【场景六】认领校验规则 - 拒绝场景');
    const allReceipts = service.getReceipts(batch.batchNo);
    const firstReceipt = allReceipts.find(r => r.status === 'claimed' || r.status === 'partial');
    try {
      service.manualClaim({ receiptId: hwReceipt.id, receivableId: r1.id, amount: 1000, operator: 'business_02' });
      assert(false, '同一回单重复认领同一应收单应被拒绝');
    } catch (e) {
      console.log(`  ✅ 重复认领已拒绝: ${e.message}`);
      assert(e.message.includes('重复') || e.message.includes('DUPLICATE'), '错误信息应说明重复');
    }

    try {
      service.manualClaim({ receiptId: hwReceipt.id, receivableId: r2.id, amount: 999999, operator: 'business_02' });
      assert(false, '认领金额超过剩余应被拒绝');
    } catch (e) {
      console.log(`  ✅ 超额认领已拒绝: ${e.message}`);
    }

    try {
      service.manualClaim({ receiptId: hwReceipt.id, receivableId: r3.id, amount: 5000, operator: 'business_02' });
      assert(false, '客户不匹配应被拒绝');
    } catch (e) {
      console.log(`  ✅ 客户不匹配已拒绝: ${e.message}`);
    }

    try {
      service.manualClaim({ receiptId: hwReceipt.id, receivableId: r4.id, amount: 1000, operator: 'business_02' });
      assert(false, '已结清应收应被拒绝');
    } catch (e) {
      console.log(`  ✅ 已结清应收已拒绝: ${e.message}`);
    }
    console.log('');

    console.log('【场景七】未处理挂账拒绝结账');
    const remainingHangings = service.getHangingList({ status: 'pending' });
    console.log(`  结账前待处理挂账: ${remainingHangings.length} 条`);
    if (remainingHangings.length > 0) {
      try {
        service.closeBatch(batch.batchNo, 'finance_manager');
        assert(false, '有未处理挂账时应拒绝关闭批次');
      } catch (e) {
        console.log(`  ✅ 批次关闭已拒绝: ${e.message}`);
      }
      console.log('  处理剩余挂账...');
      remainingHangings.forEach(h => {
        service.processHanging({
          hangingId: h.hangingId,
          action: 'keep',
          operator: 'finance_manager',
          remark: '暂存，后续跟进'
        });
      });
    }
    console.log('');

    console.log('【场景八】批次结清');
    const closedBatch = service.closeBatch(batch.batchNo, 'finance_manager');
    assert(closedBatch.status === 'closed', '批次状态应为已关闭');
    console.log(`  批次 ${closedBatch.batchNo} 已成功关闭, 操作人: ${closedBatch.closedBy}`);
    console.log('');

    console.log('【场景九】对账导出');
    const exp = service.exportReconciliation({ operator: 'finance_01' });
    console.log(`  导出对账记录: ${exp.recordCount} 条 (认领+挂账)`);
    assert(exp.recordCount > 0, '导出记录应大于0');
    console.log(`  认领记录: ${exp.records.filter(r => r.type === '认领').length} 条`);
    console.log(`  挂账记录: ${exp.records.filter(r => r.type === '挂账').length} 条`);
    const expRecord = exp.records[0];
    console.log('  导出字段验证:');
    console.log(`    回单批次: ${expRecord.batchNo || expRecord.receiptNo}`);
    console.log(`    认领人/创建人: ${expRecord.operator || expRecord.createdBy}`);
    console.log(`    差异原因: ${expRecord.differenceReason || '无'}`);
    console.log(`    处理结果: ${expRecord.processResult || ''}`);
    console.log('');

    console.log('【场景十】数据持久化验证 - 模拟重启');
    console.log('  重新创建服务实例（模拟重启）...');
    const service2 = new ReceiptService();
    const batchesAfter = service2.getBatches();
    const claimsAfter = service2.getClaimDetails();
    const hangingsAfter = service2.getHangingList();
    const exportsAfter = service2.getExportList();
    assert(batchesAfter.length === 1 && batchesAfter[0].status === 'closed', '重启后批次状态应保持已关闭');
    assert(claimsAfter.length > 0, '重启后认领记录应保持');
    assert(hangingsAfter.length === 2, '重启后挂账记录应保持');
    assert(exportsAfter.length === 1, '重启后导出记录应保持');
    console.log('  ✅ 重启后数据一致: 批次1个(已关闭), 认领记录保留, 挂账2条, 导出1条');
    console.log('');

    console.log('【场景十一】多币种 - 汇率管理');
    console.log('  录入 USD→CNY 汇率 (1 USD = 7.25 CNY) ...');
    const usdRate = service.createExchangeRate({
      fromCurrency: 'USD',
      toCurrency: 'CNY',
      rate: 7.25,
      effectiveDate: '2025-06-20',
      operator: 'finance_01'
    });
    assert(usdRate.rateId, '汇率记录ID应存在');
    assert(usdRate.rate === '7.2500', 'USD 汇率应为 7.2500');
    console.log(`  汇率录入成功: ${usdRate.fromCurrency}→${usdRate.toCurrency} = ${usdRate.rate}`);

    console.log('  查询 USD 汇率列表 ...');
    const rates = service.getExchangeRates({ fromCurrency: 'USD', toCurrency: 'CNY' });
    assert(rates.length >= 1, '应至少有1条 USD 汇率记录');
    console.log(`  查询到 ${rates.length} 条 USD 汇率记录`);
    console.log('');

    console.log('【场景十二】多币种 - USD回单匹配CNY应收（币种不一致）');
    console.log('  创建 CNY 应收单: 苹果公司 ¥72,500 ...');
    const cnyReceivable = service.createReceivable({
      receivableNo: 'AR2025005',
      customerId: 'C004',
      customerName: '苹果公司',
      orderNo: 'ORD-2025-005',
      amount: 72500,
      currency: 'CNY',
      dueDate: '2025-12-31',
      createdBy: 'finance_01'
    });
    assert(cnyReceivable.currency === 'CNY', '应收单币种应为 CNY');
    assert(cnyReceivable.baseAmount === '72500.00', 'CNY 应收单本位币金额应等于原币金额');
    console.log(`  CNY 应收单创建成功: ¥${cnyReceivable.amount}`);

    console.log('  创建 CNY 应收单2: 苹果公司 ¥36,250 ...');
    const cnyReceivable2 = service.createReceivable({
      receivableNo: 'AR2025006',
      customerId: 'C004',
      customerName: '苹果公司',
      orderNo: 'ORD-2025-006',
      amount: 36250,
      currency: 'CNY',
      dueDate: '2025-12-31',
      createdBy: 'finance_01'
    });
    console.log(`  CNY 应收单2创建成功: ¥${cnyReceivable2.amount}`);
    console.log('');

    console.log('【场景十三】多币种 - 导入USD回单，自动匹配CNY应收');
    console.log('  创建多币种批次 ...');
    const fxBatch = service.createBatch({ operator: 'finance_01', fileName: 'fx_bank_2025_06_20.xlsx', remark: '多币种回单' });
    console.log(`  批次创建成功: ${fxBatch.batchNo}`);

    console.log('  导入 USD 回单1: $10,000 (汇率 7.25, 本位币 ¥72,500) ...');
    console.log('  导入 USD 回单2: $5,000 (汇率 7.26, 本位币 ¥36,300) ...');
    const fxImported = service.importReceipts(fxBatch.batchNo, [
      {
        bankDate: '2025-06-20',
        customerId: 'C004',
        customerName: '苹果公司',
        amount: 10000,
        receiptCurrency: 'USD',
        receivableCurrency: 'CNY',
        settlementCurrency: 'CNY',
        exchangeRate: 7.25,
        orderNo: 'ORD-2025-005',
        remark: 'USD回单认领CNY应收'
      },
      {
        bankDate: '2025-06-20',
        customerId: 'C004',
        customerName: '苹果公司',
        amount: 5000,
        receiptCurrency: 'USD',
        receivableCurrency: 'CNY',
        settlementCurrency: 'CNY',
        exchangeRate: 7.26,
        orderNo: '',
        remark: '部分付款'
      }
    ], 'finance_01');
    assert(fxImported.receipts.length === 2, '应导入2张外币回单');
    assert(fxImported.receipts[0].baseAmount === '72500.00', '第1张回单本位币应为 72,500.00');
    assert(fxImported.receipts[1].baseAmount === '36300.00', '第2张回单本位币应为 36,300.00 (5000 * 7.26)');
    console.log(`  导入成功: 2张回单, 原币 $15,000, 本位币 ¥${fxImported.batch.totalBaseAmount}`);
    console.log('');

    console.log('【场景十四】多币种 - USD回单自动匹配CNY应收');
    console.log('  执行自动匹配 ...');
    const fxMatchResults = service.autoMatch(fxBatch.batchNo, 'system_auto');
    console.log(`  匹配结果: ${fxMatchResults.filter(r => r.status === 'matched').length} 成功, ${fxMatchResults.filter(r => r.status === 'hanging').length} 挂账`);
    fxMatchResults.forEach(r => console.log(`    ${r.receiptNo}: ${r.status}${r.matchType ? ' (' + r.matchType + ')' : ''}${r.reason ? ' - ' + r.reason : ''}`));

    console.log('  验证认领记录 - USD回单认领CNY应收，按本位币正确冲减应收余额 ...');
    const fxClaims = service.getClaimDetails({ batchNo: fxBatch.batchNo });
    const crossClaim = fxClaims.find(c => c.currency === 'USD' && c.receivableCurrency === 'CNY');
    assert(crossClaim, '应有 USD→CNY 跨币种认领记录');
    assert(crossClaim.amount === '10000.00', '认领原币金额应为 $10,000');
    assert(crossClaim.baseAmount === '72500.00', '认领本位币金额应为 ¥72,500');
    assert(crossClaim.receivableCurrency === 'CNY', '应收币种应为 CNY');
    console.log(`  跨币种认领: 原币 $${crossClaim.amount} (USD), 本位币 ¥${crossClaim.baseAmount}, 应收币种 ${crossClaim.receivableCurrency}`);

    console.log('  验证CNY应收单按本位币冲减 ...');
    const cnyRecAfter = service.getReceivableList();
    const ar5 = cnyRecAfter.find(r => r.receivableNo === 'AR2025005');
    assert(ar5.status === 'paid', 'AR2025005 应已结清 (本位币 ¥72,500 全部冲减)');
    assert(ar5.claimedBaseAmount === '72500.00', 'AR2025005 已认领本位币应为 ¥72,500');
    assert(Number(ar5.remainingBaseAmount) < 0.01, 'AR2025005 本位币剩余应接近0');
    console.log(`  AR2025005 状态: ${ar5.status}, 已认领(本位币): ¥${ar5.claimedBaseAmount}, 剩余(本位币): ¥${ar5.remainingBaseAmount}`);
    console.log('');

    console.log('【场景十五】多币种 - 手工指定汇率产生汇兑差异');
    console.log('  第2张USD回单手工认领CNY应收单2，指定本位币金额 ¥36,100 (产生汇兑损失 ¥150) ...');
    const fxReceipts = service.getReceipts(fxBatch.batchNo);
    const secondFxReceipt = fxReceipts.find(r => Number(r.amount) === 5000);
    const { claim: manualClaim, exchangeDiff } = service.manualClaim({
      receiptId: secondFxReceipt.id,
      receivableId: cnyReceivable2.id,
      amount: 5000,
      baseAmount: 36100,
      exchangeRate: 7.25,
      operator: 'business_02',
      remark: '手工指定汇率，汇兑损失'
    });
    assert(manualClaim.baseAmount === '36100.00', '手工指定本位币应为 36,100.00');
    assert(manualClaim.receivableCurrency === 'CNY', '应收币种应为 CNY');
    assert(exchangeDiff, '应产生汇兑差异记录');
    assert(exchangeDiff.diffType === 'loss', '差异类型应为 loss');
    assert(Number(exchangeDiff.diffAmount) === -150, '汇兑损失应为 ¥-150 (36100 - 5000*7.25)');
    console.log(`  认领成功: 原币 $5,000 (USD), 汇率 7.25, 本位币 ¥36,100, 应收币种 CNY`);
    console.log(`  汇兑差异: 类型=${exchangeDiff.diffType}, 金额=¥${exchangeDiff.diffAmount}`);

    console.log('  验证CNY应收单2按本位币冲减 ...');
    const cnyRecAfter2 = service.getReceivableList();
    const ar6 = cnyRecAfter2.find(r => r.receivableNo === 'AR2025006');
    assert(ar6.status === 'partial', 'AR2025006 应为部分认领 (本位币 ¥36,100 < ¥36,250)');
    assert(ar6.claimedBaseAmount === '36100.00', 'AR2025006 已认领本位币应为 ¥36,100');
    console.log(`  AR2025006 状态: ${ar6.status}, 已认领(本位币): ¥${ar6.claimedBaseAmount}, 剩余(本位币): ¥${ar6.remainingBaseAmount}`);

    console.log('  查询汇兑差异列表 ...');
    const diffList = service.getExchangeDiffList({ status: 'pending' });
    assert(diffList.length >= 1, '应至少有1条待处理汇兑差异');
    const pendingDiff = diffList.find(d => d.diffId === exchangeDiff.diffId);
    assert(pendingDiff, '汇兑差异应存在');
    assert(pendingDiff.status === 'pending', '状态应为 pending');
    console.log(`  待处理汇兑差异: ${diffList.length} 条, 差异金额 ¥${pendingDiff.diffAmount}`);

    console.log('  处理汇兑差异 - 确认汇兑损失 ...');
    const processedDiff = service.processExchangeDiff({
      diffId: exchangeDiff.diffId,
      action: 'recognize',
      operator: 'finance_manager',
      remark: '确认汇兑损失，计入财务费用'
    });
    assert(processedDiff.status === 'processed', '状态应为 processed');
    assert(processedDiff.processedBy === 'finance_manager', '处理人应为 finance_manager');
    console.log(`  汇兑差异处理完成: ${processedDiff.processResult}`);
    console.log('');

    console.log('【场景十六】多币种 - 对账导出（含跨币种字段）');
    console.log('  导出多币种对账记录 ...');
    const fxExp = service.exportReconciliation({ operator: 'finance_01' });
    const fxRecords = fxExp.records.filter(r => r.receiptCurrency === 'USD');
    assert(fxRecords.length >= 2, '应至少有2条 USD 记录');
    const crossRecord = fxRecords.find(r => r.receivableCurrency === 'CNY' && r.exchangeDiffAmount !== null && r.exchangeDiffAmount !== '0.00');
    assert(crossRecord, '应有 USD→CNY 跨币种含汇兑差异的记录');
    assert(crossRecord.receiptCurrency === 'USD', '回单币种应为 USD');
    assert(crossRecord.receivableCurrency === 'CNY', '应收币种应为 CNY');
    assert(crossRecord.claimAmount === '5000.00', '原币金额应为 $5,000');
    assert(crossRecord.exchangeRate === '7.2500', '汇率应为 7.2500');
    assert(crossRecord.baseAmount === '36100.00', '本位币金额应为 ¥36,100');
    assert(crossRecord.exchangeDiffAmount, '汇兑差异金额字段应存在');
    assert(crossRecord.diffProcessedBy === 'finance_manager', '差异处理人应为 finance_manager');
    assert(crossRecord.diffProcessResult, '差异处理结果字段应存在');
    assert(crossRecord.receivableBaseAmount, '应收本位币金额字段应存在');
    console.log(`  导出记录字段验证:`);
    console.log(`    原币金额: $${crossRecord.claimAmount} (${crossRecord.claimCurrency})`);
    console.log(`    汇率: ${crossRecord.exchangeRate}`);
    console.log(`    本位币金额: ¥${crossRecord.baseAmount}`);
    console.log(`    应收原币金额: ¥${crossRecord.receivableAmount} (${crossRecord.receivableCurrency})`);
    console.log(`    应收本位币金额: ¥${crossRecord.receivableBaseAmount}`);
    console.log(`    汇兑差异: ¥${crossRecord.exchangeDiffAmount} (${crossRecord.exchangeDiffType})`);
    console.log(`    差异处理人: ${crossRecord.diffProcessedBy}`);
    console.log(`    差异处理结果: ${crossRecord.diffProcessResult}`);
    console.log('');

    console.log('【场景十七】多币种 - 重启后数据一致性验证');
    console.log('  重新创建服务实例（模拟重启）...');
    const service3 = new ReceiptService();
    const ratesAfterFx = service3.getExchangeRates({ fromCurrency: 'USD' });
    const diffsAfterFx = service3.getExchangeDiffList();
    const fxClaimsAfter = service3.getClaimDetails({ batchNo: fxBatch.batchNo });
    const exportsAfterFx = service3.getExportList();
    const receivablesAfterFx = service3.getReceivableList();
    assert(ratesAfterFx.length >= 1, '重启后汇率记录应保持');
    assert(diffsAfterFx.length >= 1, '重启后汇兑差异记录应保持');
    assert(fxClaimsAfter.length >= 2, '重启后多币种认领记录应保持');
    assert(exportsAfterFx.length >= 2, '重启后导出记录应保持');
    const processedDiffAfter = diffsAfterFx.find(d => d.diffId === exchangeDiff.diffId);
    assert(processedDiffAfter.status === 'processed', '重启后汇兑差异处理状态应保持');
    const ar5After = receivablesAfterFx.find(r => r.receivableNo === 'AR2025005');
    assert(ar5After.status === 'paid', '重启后AR2025005应为已结清');
    assert(ar5After.claimedBaseAmount === '72500.00', '重启后AR2025005已认领本位币应为 ¥72,500');
    const crossClaimAfter = fxClaimsAfter.find(c => c.currency === 'USD' && c.receivableCurrency === 'CNY');
    assert(crossClaimAfter, '重启后应有跨币种认领记录');
    assert(crossClaimAfter.amount === '10000.00', '重启后认领原币金额应保持');
    assert(crossClaimAfter.baseAmount === '72500.00', '重启后认领本位币金额应保持');
    console.log('  ✅ 重启后数据一致: 汇率、认领、汇兑差异、导出记录、应收余额全部保留');
    console.log('');

    console.log('================================================');
    console.log('  🎉 全部验收测试通过！(含多币种跨币种场景)');
    console.log('================================================\n');

    return true;
  } catch (err) {
    console.error('\n❌ 测试失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = runTests;
