const { execFile } = require('child_process');

function killSpawnedProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid || process.platform !== 'win32') {
      resolve();
      return;
    }

    const numericPid = Number(pid);
    if (!Number.isInteger(numericPid) || numericPid <= 0) {
      resolve();
      return;
    }

    // Guardrail: audit scripts may only terminate the launcher process they spawned.
    execFile('taskkill.exe', ['/pid', String(numericPid), '/t', '/f'], { windowsHide: true }, () => resolve());
  });
}

module.exports = {
  killSpawnedProcessTree,
};
