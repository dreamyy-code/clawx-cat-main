const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const buildProfilePath = path.join(rootDir, 'build-profile.json');
const openClawBuildsPath = path.join(rootDir, 'openclaw-builds.json');
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const winBinDir = path.join(rootDir, 'resources', 'bin', 'win32-x64');
const electronCacheDir = path.join(rootDir, '.cache', 'electron');
const electronBuilderCacheDir = path.join(rootDir, '.cache', 'electron-builder');
const mirrorEnv = {
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  npm_config_electron_mirror: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  NODEJS_ORG_MIRROR: 'https://npmmirror.com/mirrors/node',
  ELECTRON_CACHE: electronCacheDir,
  ELECTRON_BUILDER_CACHE: electronBuilderCacheDir,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
};

const defaultProfile = {
  variant: 'main',
  displayName: 'Main Build',
  iterativeCatBaseUrl: 'https://api.iterativecat.cn',
  updateBaseUrl: 'https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main/stable',
  updateTrack: '',
  openclawTrack: 'stable',
  openclawVersion: '2026.4.2',
};

function loadOpenClawBuilds() {
  const raw = JSON.parse(fs.readFileSync(openClawBuildsPath, 'utf8'));
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  if (tracks.length === 0) {
    throw new Error('openclaw-builds.json must define at least one track');
  }

  const normalizedTracks = tracks.map((track) => {
    const id = String(track.id || '').trim();
    const displayName = String(track.displayName || id).trim() || id;
    const openclawVersion = String(track.openclawVersion || '').trim();
    const artifactSuffix = String(track.artifactSuffix || id).trim() || id;
    const updatePath = String(track.updatePath || artifactSuffix).trim() || artifactSuffix;
    if (!id || !openclawVersion) {
      throw new Error(`Invalid OpenClaw track config: ${JSON.stringify(track)}`);
    }
    return {
      id,
      displayName,
      openclawVersion,
      artifactSuffix,
      updatePath,
    };
  });

  const defaultTrackId = String(raw.defaultTrack || normalizedTracks[0].id).trim() || normalizedTracks[0].id;
  const defaultTrack = normalizedTracks.find((track) => track.id === defaultTrackId);
  if (!defaultTrack) {
    throw new Error(`Unknown defaultTrack "${defaultTrackId}" in openclaw-builds.json`);
  }

  return {
    defaultTrack,
    tracks: normalizedTracks,
  };
}

const openClawBuilds = loadOpenClawBuilds();

const variants = [
  {
    id: 'main',
    displayName: '主功能版',
    iterativeCatBaseUrl: 'https://api.iterativecat.cn',
    updateBaseUrl: 'https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/main',
    productName: 'ClawX-Cat',
    appId: 'app.clawx.desktop',
    outputDir: 'release/main',
    shortcutName: 'ClawX-Cat',
    uninstallDisplayName: 'ClawX-Cat',
  },
  {
    id: 'proxy',
    displayName: '代理版',
    iterativeCatBaseUrl: 'https://xyit.iterativecat.cn',
    updateBaseUrl: 'https://iterativecat-1372106804.cos.ap-guangzhou.myqcloud.com/aigc_files/clawx_cat/proxy',
    productName: 'ClawX-Cat-Proxy',
    appId: 'app.clawx.desktop.proxy',
    outputDir: 'release/proxy',
    shortcutName: 'ClawX-Cat-Proxy',
    uninstallDisplayName: 'ClawX-Cat-Proxy',
  },
];

const requestedVariantIds = process.argv.slice(2).map((item) => String(item || '').trim()).filter(Boolean);

function quoteArg(arg) {
  const text = String(arg);
  if (!/[ \t"]/u.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
}

function run(command, args, extraEnv = undefined) {
  const commandLine = [command, ...args.map(quoteArg)].join(' ');
  console.log(`\n> ${commandLine}`);
  execSync(commandLine, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      ...mirrorEnv,
      ...extraEnv,
    },
  });
}

function writeBuildProfile(profile) {
  fs.writeFileSync(buildProfilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  console.log(`[build-profile] ${profile.displayName}: iterativecat=${profile.iterativeCatBaseUrl}, update=${profile.updateBaseUrl}, openclaw=${profile.openclawTrack}@${profile.openclawVersion}`);
}

function ensureCleanOutput(outputDir) {
  fs.rmSync(path.join(rootDir, outputDir), { recursive: true, force: true });
}

function ensureBuildCaches() {
  fs.mkdirSync(electronCacheDir, { recursive: true });
  fs.mkdirSync(electronBuilderCacheDir, { recursive: true });
}

function finalizeOutput(stageOutputDir, finalOutputDir) {
  const stageAbsolute = path.join(rootDir, stageOutputDir);
  const finalAbsolute = path.join(rootDir, finalOutputDir);
  try {
    fs.rmSync(finalAbsolute, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(finalAbsolute), { recursive: true });
    fs.renameSync(stageAbsolute, finalAbsolute);
    console.log(`[output] Finalized: ${finalAbsolute}`);
    return finalAbsolute;
  } catch (error) {
    console.warn(`[output] Finalize skipped, keep stage output: ${stageAbsolute}`);
    console.warn(`[output] Reason: ${error instanceof Error ? error.message : String(error)}`);
    return stageAbsolute;
  }
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function verifyWindowsUpdateMetadata(outputDir, track) {
  const absoluteOutputDir = path.join(rootDir, outputDir);
  const latestYmlPath = path.join(absoluteOutputDir, 'latest.yml');
  ensureFileExists(latestYmlPath, `Windows update metadata for ${track.id}`);
  console.log(`[metadata] Windows update metadata ready: ${latestYmlPath}`);
}

function ensureBundledRuntime(toolName, relativePath, commandArgs) {
  const filePath = path.join(winBinDir, relativePath);
  if (fs.existsSync(filePath)) {
    console.log(`[runtime] Reusing ${toolName}: ${filePath}`);
    return;
  }
  run(pnpmBin, commandArgs);
}

function prepareOpenClawTrack(track) {
  console.log(`\n[openclaw] Preparing ${track.displayName}: openclaw@${track.openclawVersion}`);
  run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'scripts/update-openclaw.ps1',
    '-Version',
    track.openclawVersion,
  ]);
}

function buildVariant(variant, track) {
  const stageOutputDir = path.join('release', '.stage', `${variant.id}-${track.artifactSuffix}-${Date.now()}`);
  const finalOutputDir = path.join(variant.outputDir, track.artifactSuffix);

  writeBuildProfile({
    variant: variant.id,
    displayName: `${variant.displayName} ${track.displayName} (OpenClaw ${track.openclawVersion})`,
    iterativeCatBaseUrl: variant.iterativeCatBaseUrl,
    updateBaseUrl: `${variant.updateBaseUrl}/${track.updatePath}`,
    updateTrack: '',
    openclawTrack: track.id,
    openclawVersion: track.openclawVersion,
  });

  ensureCleanOutput(finalOutputDir);
  ensureCleanOutput(stageOutputDir);
  run(pnpmBin, ['run', 'package:assets'], {
    SKIP_PREINSTALLED_SKILLS: '1',
  });
  run(pnpmBin, [
    'exec',
    'electron-builder',
    '--win',
    '--publish',
    'never',
    `-c.directories.output=${stageOutputDir}`,
    '-c.compression=maximum',
    '-c.toolsets.winCodeSign=1.1.0',
    '-c.win.signAndEditExecutable=false',
    '-c.nsis.differentialPackage=false',
    `-c.productName=${variant.productName}`,
    `-c.appId=${variant.appId}`,
    `-c.artifactName=\${productName}-${track.artifactSuffix}-\${os}-\${arch}.\${ext}`,
    `-c.nsis.shortcutName=${variant.shortcutName}`,
    `-c.nsis.uninstallDisplayName=${variant.uninstallDisplayName}`,
  ]);
  const outputPath = finalizeOutput(stageOutputDir, finalOutputDir);
  verifyWindowsUpdateMetadata(finalOutputDir, track);
  console.log(`[artifact] ${variant.displayName} / ${track.displayName} output: ${outputPath}`);
}

try {
  ensureBuildCaches();
  ensureBundledRuntime('uv', 'uv.exe', ['exec', 'zx', 'scripts/download-bundled-uv.mjs']);
  ensureBundledRuntime('node', 'node.exe', ['exec', 'zx', 'scripts/download-bundled-node.mjs']);
  const variantsToBuild = requestedVariantIds.length === 0
    ? variants
    : variants.filter((variant) => requestedVariantIds.includes(variant.id));

  if (variantsToBuild.length === 0) {
    throw new Error(`Unknown variant(s): ${requestedVariantIds.join(', ')}`);
  }

  for (const track of openClawBuilds.tracks) {
    console.log(`\n================ ${track.displayName} / openclaw@${track.openclawVersion} ================`);
    prepareOpenClawTrack(track);
    for (const variant of variantsToBuild) {
      console.log(`\n---------------- ${variant.displayName} ----------------`);
      buildVariant(variant, track);
    }
  }
} finally {
  try {
    prepareOpenClawTrack(openClawBuilds.defaultTrack);
  } catch (error) {
    console.warn(`[openclaw] Failed to restore default track ${openClawBuilds.defaultTrack.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  writeBuildProfile(defaultProfile);
}

console.log('\n✅ Windows 双轨 OpenClaw 打包完成。');
