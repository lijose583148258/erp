const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const fail = message => { throw new Error(message); };
const required = name => {
  const value = String(valueFor(name) || '').trim();
  if (!value) fail(`Missing ${name}.`);
  return value;
};
const readJson = value => {
  const file = path.resolve(value);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail('Ingress file does not exist.');
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { fail('Ingress is invalid JSON.'); }
};

const ingress = readJson(required('--ingress'));
const namespace = required('--namespace');
const ingressName = required('--ingress-name');
const ingressClass = required('--ingress-class');
const publicHost = required('--public-host');
const serviceName = required('--service-name');
if (ingress?.metadata?.namespace !== namespace || ingress?.metadata?.name !== ingressName
  || ingress?.metadata?.deletionTimestamp) fail('Ingress identity is outside the admitted runtime scope.');
if (ingress?.spec?.ingressClassName !== ingressClass) fail('Ingress class does not match the provider-approved class.');
const unsafeAnnotations = Object.keys(ingress?.metadata?.annotations || {})
  .filter(key => /(?:configuration|server|auth)-snippet$/i.test(key));
if (unsafeAnnotations.length) fail('Ingress contains executable snippet annotations.');

const rules = Array.isArray(ingress?.spec?.rules) ? ingress.spec.rules : [];
if (rules.length !== 1 || rules[0]?.host !== publicHost) fail('Ingress host is not exclusively bound to the provider-approved hostname.');
const paths = Array.isArray(rules[0]?.http?.paths) ? rules[0].http.paths : [];
if (paths.length !== 1 || paths[0]?.path !== '/' || paths[0]?.pathType !== 'Prefix'
  || paths[0]?.backend?.service?.name !== serviceName
  || paths[0]?.backend?.service?.port?.name !== 'http') {
  fail('Ingress does not exclusively route the public root to the admitted Service HTTP port.');
}
const tls = Array.isArray(ingress?.spec?.tls) ? ingress.spec.tls : [];
if (tls.length !== 1 || !Array.isArray(tls[0]?.hosts) || tls[0].hosts.length !== 1
  || tls[0].hosts[0] !== publicHost || !String(tls[0]?.secretName || '').trim()) {
  fail('Ingress TLS is not exclusively configured for the provider-approved hostname.');
}
const loadBalancers = Array.isArray(ingress?.status?.loadBalancer?.ingress)
  ? ingress.status.loadBalancer.ingress.filter(entry => String(entry?.hostname || entry?.ip || '').trim()) : [];
if (!loadBalancers.length) fail('Ingress has no provisioned load-balancer address.');

process.stdout.write(`${JSON.stringify({
  status: 'passed', namespace, ingress: ingressName, ingressClass, publicHost,
  service: serviceName, tlsConfigured: true, loadBalancerAddressCount: loadBalancers.length,
})}\n`);
