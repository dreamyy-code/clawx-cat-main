import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings';
import { invokeIpc, toUserMessage } from '@/lib/api-client';
import { toast } from 'sonner';
import { trackUiEvent } from '@/lib/telemetry';

export function ProxySettings() {
  const { t } = useTranslation('settings');
  const {
    proxyServer,
    proxyHttpServer,
    proxyHttpsServer,
    proxyAllServer,
    proxyBypassRules,
    proxyEnabled,
    setProxyServer,
    setProxyHttpServer,
    setProxyHttpsServer,
    setProxyAllServer,
    setProxyBypassRules,
    setProxyEnabled,
  } = useSettingsStore();

  const [savingProxy, setSavingProxy] = useState(false);
  const [proxyEnabledDraft, setProxyEnabledDraft] = useState(proxyEnabled);
  const [proxyServerDraft, setProxyServerDraft] = useState(proxyServer);
  const [proxyHttpServerDraft, setProxyHttpServerDraft] = useState(proxyHttpServer);
  const [proxyHttpsServerDraft, setProxyHttpsServerDraft] = useState(proxyHttpsServer);
  const [proxyAllServerDraft, setProxyAllServerDraft] = useState(proxyAllServer);
  const [proxyBypassRulesDraft, setProxyBypassRulesDraft] = useState(proxyBypassRules);

  useEffect(() => setProxyEnabledDraft(proxyEnabled), [proxyEnabled]);
  useEffect(() => setProxyServerDraft(proxyServer), [proxyServer]);
  useEffect(() => setProxyHttpServerDraft(proxyHttpServer), [proxyHttpServer]);
  useEffect(() => setProxyHttpsServerDraft(proxyHttpsServer), [proxyHttpsServer]);
  useEffect(() => setProxyAllServerDraft(proxyAllServer), [proxyAllServer]);
  useEffect(() => setProxyBypassRulesDraft(proxyBypassRules), [proxyBypassRules]);

  const proxySettingsDirty = useMemo(() => {
    return (
      proxyEnabledDraft !== proxyEnabled
      || proxyServerDraft.trim() !== proxyServer
      || proxyHttpServerDraft.trim() !== proxyHttpServer
      || proxyHttpsServerDraft.trim() !== proxyHttpsServer
      || proxyAllServerDraft.trim() !== proxyAllServer
      || proxyBypassRulesDraft.trim() !== proxyBypassRules
    );
  }, [
    proxyAllServer, proxyAllServerDraft, proxyBypassRules, proxyBypassRulesDraft,
    proxyEnabled, proxyEnabledDraft, proxyHttpServer, proxyHttpServerDraft,
    proxyHttpsServer, proxyHttpsServerDraft, proxyServer, proxyServerDraft,
  ]);

  const handleSaveProxySettings = async () => {
    setSavingProxy(true);
    try {
      const normalizedProxyServer = proxyServerDraft.trim();
      const normalizedHttpServer = proxyHttpServerDraft.trim();
      const normalizedHttpsServer = proxyHttpsServerDraft.trim();
      const normalizedAllServer = proxyAllServerDraft.trim();
      const normalizedBypassRules = proxyBypassRulesDraft.trim();
      await invokeIpc('settings:setMany', {
        proxyEnabled: proxyEnabledDraft,
        proxyServer: normalizedProxyServer,
        proxyHttpServer: normalizedHttpServer,
        proxyHttpsServer: normalizedHttpsServer,
        proxyAllServer: normalizedAllServer,
        proxyBypassRules: normalizedBypassRules,
      });

      setProxyServer(normalizedProxyServer);
      setProxyHttpServer(normalizedHttpServer);
      setProxyHttpsServer(normalizedHttpsServer);
      setProxyAllServer(normalizedAllServer);
      setProxyBypassRules(normalizedBypassRules);
      setProxyEnabled(proxyEnabledDraft);

      toast.success(t('gateway.proxySaved'));
      trackUiEvent('settings.proxy_saved', { enabled: proxyEnabledDraft });
    } catch (error) {
      toast.error(`${t('gateway.proxySaveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSavingProxy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="settings-proxy-section">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-[14px] font-medium text-foreground/80">Gateway Proxy</Label>
          <p className="text-[13px] text-muted-foreground">
            {t('gateway.proxyDesc')}
          </p>
        </div>
        <Switch
          checked={proxyEnabledDraft}
          onCheckedChange={setProxyEnabledDraft}
          data-testid="settings-proxy-toggle"
        />
      </div>

      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          onClick={handleSaveProxySettings}
          disabled={savingProxy || !proxySettingsDirty}
          data-testid="settings-proxy-save-button"
          className="rounded-xl h-10 px-5 bg-card border-border/70 hover:bg-card"
        >
          <RefreshCw className={`h-4 w-4 mr-2${savingProxy ? ' animate-spin' : ''}`} />
          {savingProxy ? t('common:status.saving') : t('common:actions.save')}
        </Button>
        <p className="text-[12px] text-muted-foreground">
          {t('gateway.proxyRestartNote')}
        </p>
      </div>

      {proxyEnabledDraft && (
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="proxy-server" className="text-[13px] text-foreground/80">{t('gateway.proxyServer')}</Label>
              <Input
                id="proxy-server"
                value={proxyServerDraft}
                onChange={(event) => setProxyServerDraft(event.target.value)}
                placeholder="http://127.0.0.1:7890"
                className="h-10 rounded-xl bg-card border-border/60 font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                {t('gateway.proxyServerHelp')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="proxy-http-server" className="text-[13px] text-foreground/80">{t('gateway.proxyHttpServer')}</Label>
              <Input
                id="proxy-http-server"
                value={proxyHttpServerDraft}
                onChange={(event) => setProxyHttpServerDraft(event.target.value)}
                placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                className="h-10 rounded-xl bg-card border-border/60 font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                {t('gateway.proxyHttpServerHelp')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="proxy-https-server" className="text-[13px] text-foreground/80">{t('gateway.proxyHttpsServer')}</Label>
              <Input
                id="proxy-https-server"
                value={proxyHttpsServerDraft}
                onChange={(event) => setProxyHttpsServerDraft(event.target.value)}
                placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                className="h-10 rounded-xl bg-card border-border/60 font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                {t('gateway.proxyHttpsServerHelp')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="proxy-all-server" className="text-[13px] text-foreground/80">{t('gateway.proxyAllServer')}</Label>
              <Input
                id="proxy-all-server"
                value={proxyAllServerDraft}
                onChange={(event) => setProxyAllServerDraft(event.target.value)}
                placeholder={proxyServerDraft || 'socks5://127.0.0.1:7891'}
                className="h-10 rounded-xl bg-card border-border/60 font-mono text-[13px]"
              />
              <p className="text-[11px] text-muted-foreground">
                {t('gateway.proxyAllServerHelp')}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="proxy-bypass" className="text-[13px] text-foreground/80">{t('gateway.proxyBypass')}</Label>
            <Input
              id="proxy-bypass"
              value={proxyBypassRulesDraft}
              onChange={(event) => setProxyBypassRulesDraft(event.target.value)}
              placeholder="<local>;localhost;127.0.0.1;::1"
              className="h-10 rounded-xl bg-card border-border/60 font-mono text-[13px]"
            />
            <p className="text-[11px] text-muted-foreground">
              {t('gateway.proxyBypassHelp')}
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
