/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows: drag region with custom minimize/maximize/close controls.
 * Linux: use native window chrome (no custom title bar).
 */
import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { invokeIpc } from '@/lib/api-client';
import logoPng from '@/assets/logo.png';
import { useGatewayStore } from '@/stores/gateway';

export function TitleBar() {
  const platform = window.electron?.platform;

  if (platform === 'darwin') {
    // macOS: just a drag region, traffic lights are native
    return <div className="drag-region h-10 shrink-0 border-b border-border/70 bg-background" />;
  }

  // Linux keeps the native frame/title bar for better IME compatibility.
  if (platform !== 'win32') {
    return null;
  }

  return <WindowsTitleBar />;
}

function WindowsTitleBar() {
  const [maximized, setMaximized] = useState(false);
  const gatewayStatus = useGatewayStore((state) => state.status);

  useEffect(() => {
    // Check initial state
    invokeIpc('window:isMaximized').then((val) => {
      setMaximized(val as boolean);
    });
  }, []);

  const handleMinimize = () => {
    invokeIpc('window:minimize');
  };

  const handleMaximize = () => {
    invokeIpc('window:maximize').then(() => {
      invokeIpc('window:isMaximized').then((val) => {
        setMaximized(val as boolean);
      });
    });
  };

  const handleClose = () => {
    invokeIpc('window:close');
  };

  const getGatewayBadgeMeta = () => {
    if (gatewayStatus.state === 'running') {
      return {
        label: 'OpenClaw 运行中',
        className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/35',
      };
    }
    if (gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting') {
      return {
        label: 'OpenClaw 启动中',
        className: 'bg-blue-500/15 text-blue-700 border-blue-500/35',
      };
    }
    return {
      label: 'OpenClaw 启动失败',
      className: 'bg-red-500/15 text-red-700 border-red-500/35',
    };
  };
  const gatewayBadge = getGatewayBadgeMeta();
  const gatewayTooltip = gatewayStatus.error
    ? `${gatewayBadge.label}：${gatewayStatus.error}`
    : gatewayBadge.label;

  return (
    <div className="drag-region flex h-10 shrink-0 items-center justify-between border-b border-border/70 bg-background">
      <div className="flex min-w-0 items-center gap-2 px-3">
        <img src={logoPng} alt="ClawX-Cat" className="h-4 w-auto shrink-0" />
        <span className="truncate text-[13px] font-medium text-foreground/85">ClawX-Cat</span>
      </div>

      {/* Right: Window Controls */}
      <div className="no-drag flex h-full items-center gap-2 pr-1">
        <span
          title={gatewayTooltip}
          className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] font-medium ${gatewayBadge.className}`}
        >
          {gatewayBadge.label}
        </span>
        <button
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-accent transition-colors"
          title="Minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-accent transition-colors"
          title={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
