const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const uniqueAddresses = values => [...new Set(values.map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
const verifyAddressBinding = (publicAddresses, ingressAddresses) => {
  const publicSet = new Set(uniqueAddresses(publicAddresses));
  const ingressSet = new Set(uniqueAddresses(ingressAddresses));
  return publicSet.size > 0 && ingressSet.size > 0 && [...publicSet].some(address => ingressSet.has(address));
};
const lookupAddresses = async host => uniqueAddresses((await dns.lookup(host, { all: true, verbatim: true })).map(entry => entry.address));

const main = async () => {
  const ingressValue = String(valueFor('--ingress') || '').trim();
  const publicHost = String(valueFor('--public-host') || '').trim();
  if (!ingressValue || !publicHost) throw new Error('Missing --ingress or --public-host.');
  const ingressPath = path.resolve(ingressValue);
  if (!fs.existsSync(ingressPath) || !fs.statSync(ingressPath).isFile()) throw new Error('Ingress file does not exist.');
  const ingress = JSON.parse(fs.readFileSync(ingressPath, 'utf8').replace(/^\uFEFF/, ''));
  const targets = (ingress?.status?.loadBalancer?.ingress || [])
    .map(entry => String(entry?.hostname || entry?.ip || '').trim()).filter(Boolean);
  if (!targets.length) throw new Error('Ingress has no load-balancer target to bind DNS against.');
  const publicAddresses = await lookupAddresses(publicHost);
  const ingressAddresses = uniqueAddresses((await Promise.all(targets.map(lookupAddresses))).flat());
  if (!verifyAddressBinding(publicAddresses, ingressAddresses)) {
    throw new Error('Public hostname DNS does not resolve to the admitted Ingress load balancer.');
  }
  process.stdout.write(`${JSON.stringify({
    status: 'passed', publicHost, publicAddressCount: publicAddresses.length,
    ingressTargetCount: targets.length, ingressAddressCount: ingressAddresses.length,
  })}\n`);
};

module.exports = { uniqueAddresses, verifyAddressBinding };
if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
