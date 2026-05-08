const fs = require('fs');
const path = require('path');

const nextVersion = process.argv[2];

if (!nextVersion) {
  console.error('请提供版本号，例如: node set-version.cjs 0.3.9');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  console.error('版本号格式错误，应为 x.y.z 或 x.y.z-tag');
  process.exit(1);
}

const rootDir = __dirname;
const packageJsonPath = path.join(rootDir, 'package.json');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const prevVersion = packageJson.version;
packageJson.version = nextVersion;

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 4)}\n`, 'utf8');

console.log(`[package.json] ${prevVersion} -> ${nextVersion}`);
console.log('✅ 版本号更新完成，可继续执行 build.bat');
