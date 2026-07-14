#!/usr/bin/env bash
set -euo pipefail

namespace="${1:-}"
evidence_file="${2:-}"
continuous_report="${3:-}"
pilot_ledger="${4:-}"
daily_reports_dir="${5:-}"

if [[ -z "${namespace}" || -z "${evidence_file}" || -z "${continuous_report}" || -z "${pilot_ledger}" || -z "${daily_reports_dir}" ]]; then
  echo "Usage: $0 <namespace> <evidence.json> <continuous-report.json> <pilot-ledger.json> <daily-reports-dir>" >&2
  exit 2
fi

for command_name in kubectl jq node; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "Missing required command: ${command_name}" >&2
    exit 2
  }
done

[[ -f "${evidence_file}" ]] || {
  echo "Evidence file not found: ${evidence_file}" >&2
  exit 2
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

kubectl get nodes -o json > "${tmp_dir}/nodes.json"
kubectl get pods -n "${namespace}" -l app=ailaoda-app -o json > "${tmp_dir}/pods.json"
kubectl get deployment -n "${namespace}" ailaoda-app -o json > "${tmp_dir}/deployment.json"
kubectl get poddisruptionbudget -n "${namespace}" ailaoda-app -o json > "${tmp_dir}/pdb.json"

node "$(dirname "${BASH_SOURCE[0]}")/verify-pilot-observation-evidence.cjs" \
  --continuous-report "${continuous_report}" \
  --ledger "${pilot_ledger}" \
  --daily-reports-dir "${daily_reports_dir}" \
  --evidence "${evidence_file}" \
  --output "${tmp_dir}/observation-verdict.json"
jq -e '.status == "passed"' "${tmp_dir}/observation-verdict.json" >/dev/null

jq -e '
  [.items[]
    | select(.spec.unschedulable != true)
    | select(any(.status.conditions[]?; .type == "Ready" and .status == "True"))
  ] as $ready
  | ($ready | length) >= 2
  and ($ready | map(.metadata.name) | unique | length) >= 2
  and ($ready | map(.metadata.labels["topology.kubernetes.io/zone"] // "") | all(length > 0))
  and ($ready | map(.metadata.labels["topology.kubernetes.io/zone"]) | unique | length) >= 2
' "${tmp_dir}/nodes.json" >/dev/null || {
  echo "FAILED: fewer than two Ready nodes or two labeled zones" >&2
  exit 1
}

jq -e --slurpfile nodes "${tmp_dir}/nodes.json" '
  ($nodes[0].items
    | map({key: .metadata.name, value: (.metadata.labels["topology.kubernetes.io/zone"] // "")})
    | from_entries) as $zones
  | [.items[]
      | select(.status.phase == "Running")
      | select(any(.status.conditions[]?; .type == "Ready" and .status == "True"))
    ] as $ready
  | ($ready | length) >= 2
  and ($ready | map(.spec.nodeName) | unique | length) >= 2
  and ($ready | map($zones[.spec.nodeName]) | all(length > 0))
  and ($ready | map($zones[.spec.nodeName]) | unique | length) >= 2
' "${tmp_dir}/pods.json" >/dev/null || {
  echo "FAILED: application pods are not Ready across two nodes and two zones" >&2
  exit 1
}

jq -e '(.status.availableReplicas // 0) >= 2' "${tmp_dir}/deployment.json" >/dev/null || {
  echo "FAILED: deployment has fewer than two available replicas" >&2
  exit 1
}

jq -e '
  (.status.currentHealthy // 0) >= 2
  and (.status.disruptionsAllowed // 0) >= 1
' "${tmp_dir}/pdb.json" >/dev/null || {
  echo "FAILED: disruption budget cannot currently tolerate one pod loss" >&2
  exit 1
}

jq -e '
  .schemaVersion == 1
  and (.evidenceId | (type == "string" and length >= 8 and (startswith("replace-") | not)))
  and (.environment | (type == "string" and length >= 3 and (startswith("replace-") | not)))
  and (.observedAt | (type == "string" and test("^20[0-9]{2}-[0-9]{2}-[0-9]{2}T")))
  and ((now - (.observedAt | fromdateiso8601)) >= 0)
  and ((now - (.observedAt | fromdateiso8601)) <= 604800)
  and (.commitSha | type == "string" and test("^[0-9a-f]{40}$"))
  and (.imageDigest | type == "string" and test("^sha256:[0-9a-f]{64}$"))
  and .haDrill.status == "passed"
  and .haDrill.environment == .environment
  and .haDrill.changeTicket == .evidenceId
  and (.haDrill.startedAt | type == "string" and length > 0)
  and (.haDrill.finishedAt | type == "string" and length > 0)

  and .postgres.automaticElection == true
  and (.postgres.failureDomains | unique | length) >= 2
  and (.postgres.writerBefore | length) > 0
  and (.postgres.writerAfter | length) > 0
  and .postgres.writerBefore != .postgres.writerAfter
  and .postgres.rtoSeconds > 0
  and .postgres.rtoSeconds <= .postgres.maxRtoSeconds
  and .postgres.postFailoverWriteReadback == true
  and .postgres.oldPrimaryRejoinedAsReplica == true
  and .postgres.backupRestoreReadback == true
  and .haDrill.postgres.automaticElection == true
  and .haDrill.postgres.writerBefore == .postgres.writerBefore
  and .haDrill.postgres.writerAfter == .postgres.writerAfter
  and .haDrill.postgres.postFailoverWriteReadback == true

  and .redis.automaticElection == true
  and .redis.sentinelCount >= 3
  and (.redis.failureDomains | unique | length) >= 3
  and (.redis.masterBefore | length) > 0
  and (.redis.masterAfter | length) > 0
  and .redis.masterBefore != .redis.masterAfter
  and .redis.rtoSeconds > 0
  and .redis.rtoSeconds <= .redis.maxRtoSeconds
  and .redis.applicationWriteReadback == true
  and .redis.oldMasterRejoinedAsReplica == true
  and .haDrill.redis.automaticElection == true
  and .haDrill.redis.masterBefore == .redis.masterBefore
  and .haDrill.redis.masterAfter == .redis.masterAfter
  and .haDrill.redis.applicationWriteReadback == true

  and .objectStorage.crossFailureDomainDurability == true
  and .objectStorage.applicationReadFailover == true
  and .objectStorage.writeReadback == true

  and .search.applicationFallback == true
  and .search.indexRecoveryReadback == true
  and .search.backupRestoreReadback == true

  and .observability.bothApplicationTargetsUp == true
  and .observability.serviceMonitorTargets >= 2
  and .observability.alertRulesLoaded == true
  and .observability.alertsDelivered == true
  and .observability.alertDeliveryDrill == true
  and .observability.failoverTracesPresent == true
  and .observability.droppedSpanRegression == false

  and .observation.machineVerified == true
  and (.observation.continuousReportSha256 | type == "string" and test("^[0-9a-f]{64}$"))
  and (.observation.pilotLedgerSha256 | type == "string" and test("^[0-9a-f]{64}$"))
  and .observation.continuousHours >= 8
  and .observation.stagedPilotDays >= 7
  and .observation.zeroUnreconciledBusinessWrites == true
  and .observation.alertReviewCompleted == true

  and .ai.roleIsolationPassed == true
  and .ai.aggregateOnlyBoundaryPassed == true
  and .ai.dailyBudgetEnforced == true
  and .ai.circuitBreakerPassed == true
  and .ai.promptFreeTelemetryPassed == true
  and .ai.outputSafetyPassed == true
  and .ai.responseLimitPassed == true
  and .ai.localFallbackPassed == true
  and (
    .ai.externalEnabled == false
    or (
      .ai.externalGatewayAllowlistPassed == true
      and .ai.redirectBoundaryPassed == true
      and .ai.secretManagerBacked == true
      and .ai.redTeamPassed == true
    )
  )

  and (.approvals.platformOwner | length) >= 2
  and (.approvals.databaseOwner | length) >= 2
  and (.approvals.securityOwner | length) >= 2
  and (.approvals.businessPilotOwner | length) >= 2
' "${evidence_file}" >/dev/null || {
  echo "FAILED: runtime evidence does not satisfy enterprise production admission" >&2
  exit 1
}

jq -n   --arg namespace "${namespace}"   --arg evidence "${evidence_file}"   --arg checkedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"   '{status:"passed", namespace:$namespace, evidence:$evidence, checkedAt:$checkedAt,
    boundary:"Real cluster placement plus provider/operator failover evidence"}'

echo "Enterprise production admission: PASSED" >&2
