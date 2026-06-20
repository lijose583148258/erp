function buildFullCodebaseAuditMarkdown(report, jsonReportPath, markdownReportPath) {
  const md = [];
  md.push('# Full Codebase Audit v1');
  md.push('');
  md.push(`- started: ${report.meta.startedAt}`);
  md.push(`- finished: ${report.meta.finishedAt}`);
  md.push(`- active source files: ${report.summary.activeSourceFiles}`);
  md.push(`- disabled legacy files: ${report.summary.disabledLegacyFiles}`);
  md.push(`- suspicious duplicate name groups: ${report.summary.duplicateNameGroups}`);
  md.push(`- governed duplicate name groups: ${report.summary.governedDuplicateNameGroups}`);
  md.push(`- suspicious legacy-named files: ${report.summary.legacyNamedFiles}`);
  md.push(`- governed legacy/clean-named active files: ${report.summary.governedNamedActiveFiles}`);
  md.push(`- test credential assets: ${report.summary.testCredentialAssets}`);
  md.push(`- console-heavy utility assets: ${report.summary.consoleHeavyUtilityAssets}`);
  md.push(`- governed runtime script assets: ${report.summary.governedRuntimeScriptAssets}`);
  md.push(`- findings: ${JSON.stringify(report.summary.findingCounts)}`);
  md.push('');

  md.push('## P0/P1 Findings');
  for (const finding of report.findings.filter(item => item.priority === 'P0' || item.priority === 'P1')) {
    md.push(`- ${finding.priority} ${finding.category}: ${finding.title}`);
    md.push(`  - file: ${finding.file}${finding.line ? `:${finding.line}` : ''}`);
    md.push(`  - detail: ${finding.detail}`);
  }
  md.push('');

  md.push('## Largest Active Source Files');
  for (const file of report.structure.topLargestFiles.slice(0, 20)) {
    md.push(`- ${file.lines} lines / ${file.bytes} bytes / ${file.domain}: ${file.file}`);
  }
  md.push('');

  md.push('## Route Audit');
  for (const route of report.routeAudit) {
    md.push(`- ${route.file}: routes=${route.routeCount}, routerUseAuth=${route.hasRouterUseAuthenticate}, permissionRoutes=${route.permissionRoutes}, fixedRoleRoutes=${route.fixedRoleRoutes}, manualRoleGuardRoutes=${route.manualRoleGuardRoutes}, unauthenticatedCandidates=${route.unauthenticatedCandidates}`);
  }
  md.push('');

  md.push('## Suspicious Duplicate Active Source Names');
  if (report.structure.suspiciousDuplicateNames.length === 0) md.push('- none');
  for (const item of report.structure.suspiciousDuplicateNames) {
    md.push(`- ${item.name}: ${item.activeFiles.join(', ')}`);
  }
  md.push('');

  md.push('## Governed Duplicate Active Source Names');
  if (report.structure.governedDuplicateNames.length === 0) md.push('- none');
  for (const item of report.structure.governedDuplicateNames) {
    md.push(`- ${item.name} (${item.reason}): ${item.activeFiles.join(', ')}`);
  }
  md.push('');

  md.push('## Suspicious Legacy-Named Active Files');
  if (report.structure.suspiciousLegacyNamedFiles.length === 0) md.push('- none');
  for (const file of report.structure.suspiciousLegacyNamedFiles) {
    md.push(`- ${file}`);
  }
  md.push('');

  md.push('## Governed Legacy/Clean-Named Active Files');
  if (report.structure.governedNamedActiveFiles.length === 0) md.push('- none');
  for (const file of report.structure.governedNamedActiveFiles) {
    md.push(`- ${file}`);
  }
  md.push('');

  md.push('## Expected Test Credential Assets');
  for (const asset of report.structure.testCredentialAssets.slice(0, 30)) {
    md.push(`- ${asset.file}:${asset.line} (${asset.count} matches)`);
  }
  if (report.structure.testCredentialAssets.length > 30) {
    md.push(`- ... ${report.structure.testCredentialAssets.length - 30} more test/audit assets`);
  }
  md.push('');

  md.push('## Console-heavy Utility Assets');
  for (const asset of report.structure.consoleHeavyUtilityAssets.slice(0, 30)) {
    md.push(`- ${asset.file}:${asset.line} (${asset.count} console calls)`);
  }
  if (report.structure.consoleHeavyUtilityAssets.length > 30) {
    md.push(`- ... ${report.structure.consoleHeavyUtilityAssets.length - 30} more utility assets`);
  }
  md.push('');

  md.push('## Governed Runtime Script Assets');
  for (const asset of report.structure.governedRuntimeScriptAssets) {
    md.push(`- ${asset.file}:${asset.line} (${asset.operation}, ${asset.count} matches)`);
  }
  md.push('');

  md.push('## Reports');
  md.push(`- JSON: ${jsonReportPath}`);
  md.push(`- Markdown: ${markdownReportPath}`);
  return `${md.join('\n')}\n`;
}

module.exports = { buildFullCodebaseAuditMarkdown };
