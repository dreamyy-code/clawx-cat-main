const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const version = process.argv[2];

if (!version) {
  console.error('Usage: node scripts/replace-openclaw-package.cjs <version>');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const installedEntry = path.join(rootDir, 'node_modules', 'openclaw');
const cacheDir = path.join(rootDir, '.openclaw-cache', version);
const tgzPath = path.join(cacheDir, `openclaw-${version}.tgz`);
const extractDir = path.join(cacheDir, 'extract');
const pkgDir = path.join(extractDir, 'package');
const url = `https://registry.npmmirror.com/openclaw/-/openclaw-${version}.tgz`;
const substDrive = 'O:';

function fail(error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}

function updatePackageJsonVersion() {
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found: ${packageJsonPath}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (packageJson[key] && packageJson[key].openclaw) {
      packageJson[key].openclaw = version;
    }
  }
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 8)}\n`, 'utf8');
}

function resolveInstalledDir() {
  if (!fs.existsSync(installedEntry)) {
    throw new Error(`Installed openclaw entry not found: ${installedEntry}`);
  }

  return fs.realpathSync.native ? fs.realpathSync.native(installedEntry) : fs.realpathSync(installedEntry);
}

function download(urlToFetch, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(urlToFetch, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, destination).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage || ''}`.trim()));
        return;
      }

      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

function createMappedProjectRoot() {
  run('subst', [substDrive, rootDir]);
  return `${substDrive}\\`;
}

function removeMappedProjectRoot() {
  const result = spawnSync('subst', [substDrive, '/d'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.warn(`[cleanup] Failed to remove ${substDrive} mapping`);
  }
}

function extractTarball(mappedRoot) {
  const tarExe = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';

  const mappedTarball = path.join(mappedRoot, path.relative(rootDir, tgzPath));
  const mappedExtractDir = path.join(mappedRoot, path.relative(rootDir, extractDir));
  run(tarExe, ['-xf', mappedTarball, '-C', mappedExtractDir]);
}

async function main() {
  updatePackageJsonVersion();
  const installedDir = resolveInstalledDir();
  let mappedRoot = null;

  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    mappedRoot = createMappedProjectRoot();

    console.log(`[download] ${url}`);
    await download(url, tgzPath);

    console.log(`[extract] ${tgzPath}`);
    extractTarball(mappedRoot);

    if (!fs.existsSync(pkgDir)) {
      throw new Error(`Extracted package directory not found: ${pkgDir}`);
    }

    for (const entry of fs.readdirSync(installedDir)) {
      fs.rmSync(path.join(installedDir, entry), { recursive: true, force: true });
    }

    fs.cpSync(pkgDir, installedDir, { recursive: true, force: true });

    const installedPkg = JSON.parse(fs.readFileSync(path.join(installedDir, 'package.json'), 'utf8'));
    console.log(`[package.json] openclaw -> ${version}`);
    console.log(`[node_modules] ${installedDir}`);
    console.log(`[installed] openclaw@${installedPkg.version}`);
  } finally {
    if (mappedRoot) {
      removeMappedProjectRoot();
    }
  }
}

main().catch(fail);
