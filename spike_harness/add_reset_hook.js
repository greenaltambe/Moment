const fs = require('fs');
let bg = fs.readFileSync('/home/greenaltambe/Projects/Moment/spike_harness/background.js', 'utf8');
if (!bg.includes('__MOMENT_RESET__')) {
  bg = bg.replace("const targetUrl = details.url;", `const targetUrl = details.url;
  if (targetUrl.includes('__MOMENT_RESET__')) {
    activeGrants.clear();
    pendingRequests.clear();
    log('ALL_GRANTS_CLEARED_VIA_HOOK', {});
    return;
  }`);
  fs.writeFileSync('/home/greenaltambe/Projects/Moment/spike_harness/background.js', bg);
}
console.log('Added reset hook');
