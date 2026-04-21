# 修复 ProductionWorkspaceV2.tsx 被损坏的区域
$filePath = 'f:\爱牢达\pages\ProductionWorkspaceV2.tsx'
$content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)

# 被损坏的文本块（精确匹配）
$broken = @"
        adjustmentService.getAll({ page: 1, pageSize: 100, domain: 'production', status: adjustmentStatus === 'all' ? undefined : adjustmentStatus }),
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

  const resetWoForm = () =>
"@

# 修复后的完整文本块
$fixed = @"
        adjustmentService.getAll({ page: 1, pageSize: 100, domain: 'production', status: adjustmentStatus === 'all' ? undefined : adjustmentStatus }),
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
    const events: { label: string; time: Date; place: string; status: string }[] = [];
    const linkedWo = workOrders.find(wo => wo.batchId === selectedBatch.id);
    if (linkedWo) {
      events.push({ label: '工单创建', time: new Date(linkedWo.createdAt), place: ``工单 `${linkedWo.workOrderNo}``, status: '已创建' });
      if (linkedWo.actualStartAt) events.push({ label: '开始生产', time: new Date(linkedWo.actualStartAt), place: '生产线', status: '已开始' });
      for (const qc of (linkedWo.qualityChecks || [])) {
        events.push({ label: ``质检 `${qc.result === 'pass' ? '通过' : qc.result === 'fail' ? '不合格' : '待检'}``, time: new Date(qc.checkedAt || qc.createdAt), place: ``质检 `${qc.checkNo}``, status: qc.result === 'pass' ? '已通过' : qc.result === 'fail' ? '不合格' : '待检' });
      }
      if (linkedWo.actualEndAt) events.push({ label: '生产完成', time: new Date(linkedWo.actualEndAt), place: '完工入库', status: '已完成' });
    } else {
      events.push({ label: '生产完成', time: productionDate, place: '生产线', status: '已记录' });
    }
    events.push({ label: '效期管控', time: expiryDate, place: '合规', status: (selectedBatch as any).status === 'expired' ? '已过期' : '待到期' });
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

  const resetWoForm = () =>
"@

if ($content.Contains('setBomBatchSizeUnit')) {
    $content = $content.Replace($broken, $fixed)
    [System.IO.File]::WriteAllText($filePath, $content, [System.Text.Encoding]::UTF8)
    Write-Output "SUCCESS: File repaired"
} else {
    Write-Output "ERROR: Target text not found"
}
