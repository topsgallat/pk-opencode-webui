const fs = require('fs');
const content = fs.readFileSync('.sisyphus/outputs/qa-screenshots/auth-1-missing-password-prompt.png').toString('base64');
console.log(content.slice(0, 100));
