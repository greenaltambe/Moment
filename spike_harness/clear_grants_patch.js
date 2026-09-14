// Update background.js to include CLEAR_ALL_GRANTS
const fs = require('fs');
let bg = fs.readFileSync('/home/greenaltambe/Projects/Moment/spike_harness/background.js', 'utf8');
if (!bg.includes('CLEAR_ALL_GRANTS')) {
  bg = bg.replace("if (message.action === 'EXPIRE_GRANT_NOW')", `
  if (message.action === 'CLEAR_ALL_GRANTS') {
    activeGrants.clear();
    pendingRequests.clear();
    log('ALL_GRANTS_CLEARED', {});
    sendResponse({ status: 'CLEARED' });
    return true;
  }
  if (message.action === 'EXPIRE_GRANT_NOW')`);
  fs.writeFileSync('/home/greenaltambe/Projects/Moment/spike_harness/background.js', bg);
}
console.log('Patched background.js');
