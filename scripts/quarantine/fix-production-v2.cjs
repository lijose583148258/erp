// 修复 ProductionWorkspaceV2.tsx 被损坏的区域
const fs = require('fs');
const filePath = 'f:\\爱牢达\\pages\\ProductionWorkspaceV2.tsx';
let content = fs.readFileSync(filePath, 'utf-8');

// 找到损坏区域的标志
const brokenMarker = "adjustmentService.getAll({ page: 1, pageSize: 100, domain: 'production', status: adjustmentStatus === 'all' ? undefined : adjustmentStatus }),\r\n    setBomBatchSizeUnit('kg');";

if (!content.includes(brokenMarker)) {
  // 也尝试 LF
  const brokenMarkerLF = brokenMarker.replace(/\r\n/g, '\n');
  if (!content.includes(brokenMarkerLF)) {
    console.log('ERROR: 损坏标记未找到，文件可能已经修复或损坏方式不同');
    process.exit(1);
  }
}

// 需要替换的损坏文本
const brokenText = `        adjustmentService.getAll({ page: 1, pageSize: 100, domain: 'production', status: adjustmentStatus === 'all' ? undefined : adjustmentStatus }),
    setBomBatchSizeUnit('kg');
    setBomDensity('');
    setBomSolidContent('');
    setBomEffectiveFrom('');
    setBomEffectiveTo('');
    setBomProcessText('');
    setBomQualitySpecText('');
    setBomNotes('');
    setBomItems([newBomItem()]);
  };

  const resetWoForm = () =>`;

// 修复后的完整文本
const fixedText = `        adjustmentService.getAll({ page: 1, pageSize: 100, domain: 'production', status: adjustmentStatus === 'all' ? undefined : adjustmentStatus }),
      ]);

      setSummary(summaryData);
      setBoms(bomData);
      setWorkOrders(workOrderData);
      setBatches(batchData);
      setAdjustments(adjustmentData.data || []);
      setSelectedBomId(prev => (prev && bomData.some(item => item.id === prev) ? prev : bomData[0]?.id ?? null));
      setSelectedWorkOrderId(prev => (prev && workOrderData.some(item => item.id === prev) ? prev : workOrderData[0]?.id ?? null));
      setSelectedBatchId(prev => (prev && batchData.some(item => item.id === prev) ? prev : batchData[0]?.id ?? null));
    } catch (error) {
        notify('error', error instanceof Error ? error.message : '加载生产工作台失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, [workOrderKeyword, workOrderFilter, batchKeyword, batchStatus, adjustmentStatus]);
  useEffect(() => { if (selectedBom && !woProductName.trim()) setWoProductName(selectedBom.productName); if (selectedBom) setBomOutputUnit(selectedBom.outputUnit || 'kg'); }, [selectedBom, woProductName]);
  useEffect(() => { if (selectedBatch && !woProductName.trim()) setWoProductName(selectedBatch.productName); }, [selectedBatch, woProductName]);

  const displayedBoms = useMemo(() => {
    const keyword = bomKeyword.trim().toLowerCase();
    return keyword ? boms.filter(item => item.productName.toLowerCase().includes(keyword) || item.bomNo.toLowerCase().includes(keyword) || (item.version || '').toLowerCase().includes(keyword)) : boms;
  }, [boms, bomKeyword]);

  const stats = useMemo(() => ({
    totalBoms: summary?.bomCount ?? boms.length,
    totalWorkOrders: summary?.workOrderCount ?? workOrders.length,
    activeWorkOrders: summary?.activeWorkOrders ?? workOrders.filter(item => ['planned', 'in_progress', 'qc_pending'].includes(item.status)).length,
    qcPendingCount: summary?.qcPendingCount ?? workOrders.filter(item => item.status === 'qc_pending').length,
    batchCount: summary?.batchCount ?? batches.length,
    totalStock: batches.reduce((sum, batch) => sum + Number(batch.stockQuantity || 0), 0),
  }), [summary, boms.length, batches, workOrders]);
  const isInitialLoading = loading && !summary;
  const bomPercentageSummary = useMemo(
    () => bomItems.reduce((sum, item) => sum + Number(item.percentage || 0), 0),
    [bomItems],
  );
  const numericStandardBatchSize = useMemo(
    () => Number(bomStandardBatchSize || 0),
    [bomStandardBatchSize],
  );
  const selectedBomPercentageSummary = useMemo(
    () => (selectedBom?.items || []).reduce((sum, item) => sum + Number(item.percentage || 0), 0),
    [selectedBom],
  );
  const selectedBomProcessSummary = useMemo(
    () => getJsonSummary(selectedBom?.processJson),
    [selectedBom],
  );
  const selectedBomQualitySummary = useMemo(
    () => getJsonSummary(selectedBom?.qualitySpecJson),
    [selectedBom],
  );

  const batchTrace = useMemo(() => {
    if (!selectedBatch) return [];
    const productionDate = new Date(selectedBatch.productionDate);
    const expiryDate = new Date(selectedBatch.expiryDate);
    const events = [];
    const linkedWo = workOrders.find(wo => wo.batchId === selectedBatch.id);
    if (linkedWo) {
      events.push({ label: '工单创建', time: new Date(linkedWo.createdAt), place: \`工单 \${linkedWo.workOrderNo}\`, status: '已创建' });
      if (linkedWo.actualStartAt) events.push({ label: '开始生产', time: new Date(linkedWo.actualStartAt), place: '生产线', status: '已开始' });
      for (const qc of (linkedWo.qualityChecks || [])) {
        events.push({ label: \`质检 \${qc.result === 'pass' ? '通过' : qc.result === 'fail' ? '不合格' : '待检'}\`, time: new Date(qc.checkedAt || qc.createdAt), place: \`质检 \${qc.checkNo}\`, status: qc.result === 'pass' ? '已通过' : qc.result === 'fail' ? '不合格' : '待检' });
      }
      if (linkedWo.actualEndAt) events.push({ label: '生产完成', time: new Date(linkedWo.actualEndAt), place: '完工入库', status: '已完成' });
    } else {
      events.push({ label: '生产完成', time: productionDate, place: '生产线', status: '已记录' });
    }
    events.push({ label: '效期管控', time: expiryDate, place: '合规', status: selectedBatch.status === 'expired' ? '已过期' : '待到期' });
    events.sort((a, b) => a.time.getTime() - b.time.getTime());
    return events;
  }, [selectedBatch, workOrders]);

  const resetBomForm = () => {
    setBomProductName('');
    setBomVersion('v1');
    setBomType('standard');
    setBomStatus('draft');
    setBomFormulationMode('fixed');
    setBomOutputUnit('kg');
    setBomStandardBatchSize('');
    setBomBatchSizeUnit('kg');
    setBomDensity('');
    setBomSolidContent('');
    setBomEffectiveFrom('');
    setBomEffectiveTo('');
    setBomProcessText('');
    setBomQualitySpecText('');
    setBomNotes('');
    setBomItems([newBomItem()]);
  };

  const resetWoForm = () =>`;

// 尝试 CRLF 和 LF 两种变体
let replaced = false;
const brokenCRLF = brokenText.replace(/\n/g, '\r\n');
const fixedCRLF = fixedText.replace(/\n/g, '\r\n');

if (content.includes(brokenCRLF)) {
  content = content.replace(brokenCRLF, fixedCRLF);
  replaced = true;
} else if (content.includes(brokenText)) {
  content = content.replace(brokenText, fixedText);
  replaced = true;
}

if (replaced) {
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('SUCCESS: 文件已修复');
} else {
  console.log('ERROR: 未找到匹配的损坏文本');
}
