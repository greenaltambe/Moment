const fs = require('fs');
let code = fs.readFileSync('/home/greenaltambe/Projects/Moment/spike_harness/test_all_scenarios_v2.js', 'utf8');
code = code.replace("let handles = (await send('WebDriver:GetWindowHandles')).value;", `
  let rawHandles = await send('WebDriver:GetWindowHandles');
  let handles = Array.isArray(rawHandles) ? rawHandles : (rawHandles.value || []);
`);
fs.writeFileSync('/home/greenaltambe/Projects/Moment/spike_harness/test_all_scenarios_v2.js', code);
console.log('Fixed handles parsing');
