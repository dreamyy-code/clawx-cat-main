/**
 * System Tray Management
 * Creates and manages the system tray icon and menu
 */
import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import { join } from 'path';
import { getSetting } from '../utils/store';
import { resolveSupportedLanguage, type LanguageCode } from '../../shared/language';

let tray: Tray | null = null;
let trayWindow: BrowserWindow | null = null;

const TRAY_I18N: Record<LanguageCode, {
  tooltip: string;
  show: string;
  gatewayStatus: string;
  running: string;
  quickActions: string;
  openChat: string;
  openSettings: string;
  checkForUpdates: string;
  quit: string;
  hiddenTitle: string;
  hiddenBody: string;
}> = {
  zh: {
    tooltip: 'ClawX-Cat - AI 助手',
    show: '显示 ClawX-Cat',
    gatewayStatus: 'Gateway 状态',
    running: '运行中',
    quickActions: '快捷操作',
    openChat: '打开聊天',
    openSettings: '打开设置',
    checkForUpdates: '检查更新...',
    quit: '退出 ClawX-Cat',
    hiddenTitle: 'ClawX-Cat 仍在后台运行',
    hiddenBody: '关闭窗口后，程序已隐藏到系统托盘。可通过托盘菜单重新打开或退出。',
  },
  en: {
    tooltip: 'ClawX-Cat - AI Assistant',
    show: 'Show ClawX-Cat',
    gatewayStatus: 'Gateway Status',
    running: 'Running',
    quickActions: 'Quick Actions',
    openChat: 'Open Chat',
    openSettings: 'Open Settings',
    checkForUpdates: 'Check for Updates...',
    quit: 'Quit ClawX-Cat',
    hiddenTitle: 'ClawX-Cat is still running',
    hiddenBody: 'Closing the window hides the app to the system tray. Use the tray menu to reopen or quit.',
  },
  ja: {
    tooltip: 'ClawX-Cat - AI アシスタント',
    show: 'ClawX-Cat を表示',
    gatewayStatus: 'Gateway 状態',
    running: '実行中',
    quickActions: 'クイック操作',
    openChat: 'チャットを開く',
    openSettings: '設定を開く',
    checkForUpdates: '更新を確認...',
    quit: 'ClawX-Cat を終了',
    hiddenTitle: 'ClawX-Cat はバックグラウンドで実行中です',
    hiddenBody: 'ウィンドウを閉じると、アプリはシステムトレイに隠れます。トレイメニューから再表示または終了できます。',
  },
};

export function getTrayLabels(language: string | null | undefined): typeof TRAY_I18N[LanguageCode] {
  return TRAY_I18N[resolveSupportedLanguage(language)];
}

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

function buildTrayMenu(mainWindow: BrowserWindow, labels: typeof TRAY_I18N[LanguageCode]): Menu {
  const showWindow = () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  };

  return Menu.buildFromTemplate([
    {
      label: labels.show,
      click: showWindow,
    },
    {
      type: 'separator',
    },
    {
      label: labels.gatewayStatus,
      enabled: false,
    },
    {
      label: `  ${labels.running}`,
      type: 'checkbox',
      checked: true,
      enabled: false,
    },
    {
      type: 'separator',
    },
    {
      label: labels.quickActions,
      submenu: [
        {
          label: labels.openChat,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/');
          },
        },
        {
          label: labels.openSettings,
          click: () => {
            if (mainWindow.isDestroyed()) return;
            mainWindow.show();
            mainWindow.webContents.send('navigate', '/settings');
          },
        },
      ],
    },
    {
      type: 'separator',
    },
    {
      label: labels.checkForUpdates,
      click: () => {
        if (mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('update:check');
      },
    },
    {
      type: 'separator',
    },
    {
      label: labels.quit,
      click: () => {
        app.quit();
      },
    },
  ]);
}

async function getTrayLanguage(): Promise<LanguageCode> {
  try {
    const raw = await getSetting('language');
    return resolveSupportedLanguage(typeof raw === 'string' ? raw : undefined);
  } catch {
    return 'en';
  }
}

export async function refreshTrayMenu(): Promise<void> {
  if (!tray || !trayWindow || trayWindow.isDestroyed()) return;
  const language = await getTrayLanguage();
  const labels = getTrayLabels(language);
  tray.setToolTip(labels.tooltip);
  tray.setContextMenu(buildTrayMenu(trayWindow, labels));
}

/**
 * Create system tray icon and menu
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  // Use platform-appropriate icon for system tray
  const iconsDir = getIconsDir();
  let iconPath: string;

  if (process.platform === 'win32') {
    // Windows: use .ico for best quality in system tray
    iconPath = join(iconsDir, 'icon.ico');
  } else if (process.platform === 'darwin') {
    // macOS: use Template.png for proper status bar icon
    // The "Template" suffix tells macOS to treat it as a template image
    iconPath = join(iconsDir, 'tray-icon-Template.png');
  } else {
    // Linux: use 32x32 PNG
    iconPath = join(iconsDir, '32x32.png');
  }

  let icon = nativeImage.createFromPath(iconPath);

  // Fallback to icon.png if platform-specific icon not found
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(join(iconsDir, 'icon.png'));
    // Still try to set as template for macOS
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
  }

  // Note: Using "Template" suffix in filename automatically marks it as template image
  // But we can also explicitly set it for safety
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }
  
  tray = new Tray(icon);
  trayWindow = mainWindow;
  const defaultLabels = TRAY_I18N.en;
  tray.setToolTip(defaultLabels.tooltip);
  tray.setContextMenu(buildTrayMenu(mainWindow, defaultLabels));
  void refreshTrayMenu();
  
  // Click to show window (Windows/Linux)
  tray.on('click', () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  
  // Double-click to show window (Windows)
  tray.on('double-click', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
  
  return tray;
}

/**
 * Update tray tooltip with Gateway status
 */
export function updateTrayStatus(status: string): void {
  if (tray) {
    tray.setToolTip(`ClawX-Cat - ${status}`);
  }
}

/**
 * Destroy tray icon
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  trayWindow = null;
}
