const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const fail = message => { throw new Error(message); };
const readJson = (flag, label) => {
  const value = String(valueFor(flag) || '').trim();
  if (!value) fail(`Missing ${flag}.`);
  const file = path.resolve(value);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`${label} file does not exist.`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { fail(`${label} is invalid JSON.`); }
};
const exactObject = (actual, expected) => {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const actualEntries = Object.entries(actual).sort(([a], [b]) => a.localeCompare(b));
  const expectedEntries = Object.entries(expected).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
};
const exactSelector = (selector, labels) => selector && exactObject(selector.matchLabels, labels)
  && (!Array.isArray(selector.matchExpressions) || selector.matchExpressions.length === 0)
  && Object.keys(selector).every(key => ['matchLabels', 'matchExpressions'].includes(key));

const policy = readJson('--network-policy', 'NetworkPolicy');
const provider = readJson('--provider-summary', 'Provider summary');
const namespace = String(valueFor('--namespace') || '').trim();
const expected = provider.applicationNetworkPolicy;
if (!expected || policy?.metadata?.namespace !== namespace || policy?.metadata?.name !== expected.name
  || policy?.metadata?.deletionTimestamp) fail('NetworkPolicy identity does not match the provider-approved runtime scope.');
if (!exactSelector(policy?.spec?.podSelector, { app: 'ailaoda-app' })) {
  fail('NetworkPolicy does not exclusively select the application Pods.');
}
if (!Array.isArray(policy?.spec?.policyTypes) || policy.spec.policyTypes.length !== 1
  || policy.spec.policyTypes[0] !== 'Ingress' || policy?.spec?.egress !== undefined) {
  fail('Application NetworkPolicy must isolate ingress without asserting an unreviewed egress policy.');
}

const expectedPeers = new Map([
  [expected.ingressControllerNamespace, expected.ingressControllerPodLabels],
  [expected.observabilityNamespace, expected.observabilityPodLabels],
]);
const seen = new Set();
const rules = Array.isArray(policy?.spec?.ingress) ? policy.spec.ingress : [];
if (rules.length !== expectedPeers.size) fail('NetworkPolicy must contain exactly the provider-approved ingress rules.');
for (const rule of rules) {
  if (!Array.isArray(rule?.ports) || rule.ports.length !== 1 || rule.ports[0]?.protocol !== 'TCP'
    || Number(rule.ports[0]?.port) !== 5001 || rule.ports[0]?.endPort !== undefined
    || !Array.isArray(rule?.from) || rule.from.length !== 1) {
    fail('NetworkPolicy ingress rules must expose only TCP container port 5001 to one peer.');
  }
  const peer = rule.from[0];
  if (peer?.ipBlock !== undefined
    || !exactSelector(peer?.namespaceSelector, { 'kubernetes.io/metadata.name': Object.keys(peer?.namespaceSelector?.matchLabels || {}).length ? peer.namespaceSelector.matchLabels['kubernetes.io/metadata.name'] : '' })) {
    fail('NetworkPolicy peer requires one exact namespace selector and no IP block.');
  }
  const peerNamespace = String(peer.namespaceSelector.matchLabels['kubernetes.io/metadata.name'] || '');
  const expectedLabels = expectedPeers.get(peerNamespace);
  if (!expectedLabels || seen.has(peerNamespace) || !exactSelector(peer?.podSelector, expectedLabels)) {
    fail('NetworkPolicy peer does not match a unique provider-approved caller.');
  }
  seen.add(peerNamespace);
}
if (seen.size !== expectedPeers.size) fail('NetworkPolicy does not cover every provider-approved caller.');

process.stdout.write(`${JSON.stringify({
  status: 'passed', namespace, networkPolicy: expected.name,
  protectedPodSelector: { app: 'ailaoda-app' }, allowedCallerCount: seen.size,
  allowedNamespaces: [...seen].sort(), port: 5001, protocol: 'TCP',
})}\n`);
