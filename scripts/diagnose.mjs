/**
 * 一次性排查脚本：确认哪个 App 是活的、谁在读写设置
 *
 * 放成文件而不是 node -e：cmd 对反斜杠和引号的转义会把正则搞坏。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = 'E:/agent_workspace/NativeMind';
const files = [];

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
};
walk(path.join(root, 'src'));
walk(path.join(root, 'tests'));

const report = (label, predicate) => {
  console.log('--- ' + label);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (predicate(text)) console.log('   ' + file.replace(/\\/g, '/').replace(root, ''));
  }
};

console.log('index.html script tag:');
console.log('   ' + (fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<script[^>]*src="[^"]*"[^>]*>/) ?? ['(none)'])[0]);

report('imports src/App (the legacy demo shell)', (t) => /from ['"][^'"]*\/App['"]/.test(t) && !/ui\/App/.test(t));
report('imports ui/App (the real shell)', (t) => /from ['"][^'"]*ui\/App['"]/.test(t));
report('touches repositories.settings', (t) => /repositories\.settings|SettingsRepository/.test(t));
report('persists companion config', (t) => /updateConfig/.test(t));
