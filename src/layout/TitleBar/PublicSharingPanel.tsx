import { useEffect, useId, useState } from "react";
import Icons from "../../components/Icons";
import Select from "../../components/Select";
import { getLocale, useT } from "../../i18n";
import { invoke } from "../../ipc/transport";
import { platform } from "../../platform";
import { sharingText } from "../../sharing/copy";
import { remoteDevices, type RemoteDevice } from "../../sharing/remoteApi";
import "./public-sharing.css";

interface Options {
  options: { scopes: string[] };
  projects: { id: string; name: string }[];
  sessions: { id: string; name: string; projectId: string; projectName: string }[];
}

type Translate = (message: string) => string;

function scopeLabel(scope: string, t: Translate) {
  return t(scope === "machine" ? "remote.workspace" : scope);
}

function ScopeIcon({ scope, size = 18 }: { scope: string; size?: number }) {
  const Icon = scope === "machine" ? Icons.monitor : scope === "project" ? Icons.project :
    scope === "session" ? Icons.bot : Icons.share;
  return <Icon aria-hidden="true" size={size} />;
}

export function PublicSharingPanel() {
  useT();
  const t = (message: string) => sharingText(message, getLocale());
  const scopeGroupId = useId();
  const [account, setAccount] = useState<{ id: string; displayName: string } | null>(null);
  const [linked, setLinked] = useState(false);
  const [ready, setReady] = useState(false);
  const [linking, setLinking] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [links, setLinks] = useState<RemoteDevice["access"]>([]);
  const [options, setOptions] = useState<Options | null>(null);
  const [scope, setScope] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError("");
    try {
      const status = await invoke<{
        linked: boolean;
        deviceId?: string;
        account?: { id: string; displayName: string };
      }>("public_account_status");
      setLinked(status.linked);
      setAccount(status.account ?? null);
      if (!status.linked) {
        setOptions(null);
        setLinks([]);
        return;
      }
      const [nextOptions, devices] = await Promise.all([
        invoke<Options>("public_remote_options"),
        remoteDevices(),
      ]);
      setOptions(nextOptions);
      setLinks(devices.find((device) => device.id === status.deviceId)?.access ?? []);
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    void refresh().catch(() => setError(t("remote.load_failed")));
  }, []);

  useEffect(() => {
    if (!linking) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 10 * 60 * 1000;
    async function poll() {
      try {
        const status = await invoke<{ linked: boolean }>("public_account_poll");
        if (stopped) return;
        if (status.linked) {
          setLinking(false);
          // Notify other account views only when linking succeeds, never during a status read.
          window.dispatchEvent(new Event("public-account-changed"));
          await refresh();
          return;
        }
        if (Date.now() >= deadline) {
          setLinking(false);
          setError(t("The request failed. Check the account service and try again."));
          return;
        }
        timer = setTimeout(() => void poll(), 2000);
      } catch {
        if (!stopped) {
          setLinking(false);
          setError(t("The request failed. Check the account service and try again."));
        }
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [linking]);

  async function action(
    job: () => Promise<void>,
    failure = t("The request failed. Check the account service and try again."),
  ) {
    setBusy(true);
    setError("");
    try {
      await job();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const targets = scope === "project" ? options?.projects ?? [] :
    scope === "session" ? options?.sessions ?? [] : [];
  const canSubmit = Boolean(scope) && (scope === "machine" || Boolean(target)) && !busy;

  return (
    <section className="public-sharing" aria-labelledby="public-sharing-title">
      <header className="public-sharing-hero">
        <span className="public-sharing-hero-icon"><Icons.share aria-hidden="true" size={19} /></span>
        <div>
          <h3 id="public-sharing-title">{t("remote.title")}</h3>
          <p>{t("remote.intro")}</p>
        </div>
      </header>

      {error && (
        <div className="public-sharing-error" role="alert">
          <Icons.info aria-hidden="true" size={16} />
          <span>{error}</span>
          <button
            className="public-sharing-button public-sharing-button-compact"
            disabled={busy}
            type="button"
            onClick={() => void action(refresh, t("remote.load_failed"))}
          >
            {t("projects.retry")}
          </button>
        </div>
      )}

      {!ready ? (
        <div className="public-sharing-loading" role="status">
          <span className="public-sharing-spinner" aria-hidden="true" />
          {t("Loading…")}
        </div>
      ) : !linked ? (
        <div className="public-sharing-login">
          <span className="public-sharing-login-icon"><Icons.account aria-hidden="true" size={20} /></span>
          <div className="public-sharing-login-copy">
            <strong>{t("Sign in to VelaTerm")}</strong>
            <p>{t("remote.login")}</p>
          </div>
          <button
            className="public-sharing-button public-sharing-button-primary"
            disabled={busy || linking}
            type="button"
            onClick={() => void action(async () => {
              const result = await invoke<{ url: string; publicKey: string }>("public_account_link", { name: "VelaTerm" });
              setPublicKey(result.publicKey);
              await platform.opener.openExternal(result.url);
              setLinking(true);
            })}
          >
            <Icons.account aria-hidden="true" size={15} />
            {t("Sign in to VelaTerm")}
          </button>
          {linking && <p className="public-sharing-login-status" role="status">{t("login.wait")}</p>}
          {linking && (
            <details className="public-sharing-login-details">
              <summary>{t("login.details")}</summary>
              <code>{publicKey}</code>
            </details>
          )}
        </div>
      ) : (
        <div className="public-sharing-sections">
          {account && (
            <section className="public-sharing-account" aria-label={t("Account")}>
              <span className="public-sharing-account-avatar"><Icons.account aria-hidden="true" size={18} /></span>
              <div className="public-sharing-account-identity">
                <strong>{account.displayName}</strong>
                <span>{t("Account ID:")} <code>{account.id}</code></span>
              </div>
              <div className="public-sharing-account-actions">
                <a
                  className="public-sharing-button"
                  href="https://velaterm.com/account"
                  rel="noreferrer"
                  target="_blank"
                  onClick={(event) => {
                    event.preventDefault();
                    void platform.opener.openExternal(event.currentTarget.href);
                  }}
                >
                  {t("Account")}
                  <Icons.external aria-hidden="true" size={13} />
                </a>
                <button
                  className="public-sharing-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void action(async () => {
                    await invoke("public_account_logout");
                    setLinked(false);
                    setAccount(null);
                    setOptions(null);
                    setLinks([]);
                    window.dispatchEvent(new Event("public-account-changed"));
                  })}
                >
                  {t("Sign out")}
                </button>
              </div>
              <p className="public-sharing-account-hint">{t("projects.logout_hint")}</p>
            </section>
          )}

          {options && (
            <section className="public-sharing-card" aria-labelledby="public-sharing-create-title">
              <div className="public-sharing-section-heading">
                <span className="public-sharing-section-icon"><Icons.plus aria-hidden="true" size={16} /></span>
                <h4 id="public-sharing-create-title">{t("remote.enable")}</h4>
              </div>
              <form onSubmit={(event) => {
                event.preventDefault();
                if (!canSubmit) return;
                void action(async () => {
                  await invoke("public_account_remote_enable", {
                    scope,
                    targetId: scope === "machine" ? null : target,
                  });
                  await refresh();
                });
              }}>
                <fieldset>
                  <legend>{t("Scope")}</legend>
                  <div className="public-sharing-scope-options">
                    {options.options.scopes.map((value, index) => (
                      <label
                        className={scope === value ? "is-selected" : ""}
                        key={value}
                        htmlFor={`${scopeGroupId}-${index}`}
                      >
                        <input
                          checked={scope === value}
                          disabled={busy}
                          id={`${scopeGroupId}-${index}`}
                          name={scopeGroupId}
                          type="radio"
                          value={value}
                          onChange={() => {
                            setScope(value);
                            setTarget("");
                          }}
                        />
                        <span className="public-sharing-scope-icon"><ScopeIcon scope={value} /></span>
                        <strong>{scopeLabel(value, t)}</strong>
                        <span className="public-sharing-scope-check"><Icons.check aria-hidden="true" size={13} /></span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {scope && scope !== "machine" && (
                  <label className="public-sharing-target">
                    <span>{scopeLabel(scope, t)}</span>
                    <Select
                      width="100%"
                      disabled={busy}
                      value={target}
                      ariaLabel={scopeLabel(scope, t)}
                      onChange={setTarget}
                      options={[
                        { value: "", label: t("Select…") },
                        ...targets.map((item) => ({
                          value: item.id,
                          label: "projectName" in item ? `${item.projectName} / ${item.name}` : item.name,
                        })),
                      ]}
                    />
                  </label>
                )}

                <div className="public-sharing-form-actions">
                  <button
                    className="public-sharing-button public-sharing-button-primary"
                    disabled={!canSubmit}
                    type="submit"
                  >
                    <Icons.share aria-hidden="true" size={15} />
                    {t("remote.enable")}
                  </button>
                </div>
              </form>
            </section>
          )}

          {options && (
            <section className="public-sharing-card" aria-labelledby="public-sharing-active-title">
              <div className="public-sharing-section-heading">
                <span className="public-sharing-section-icon"><Icons.publicShare aria-hidden="true" size={16} /></span>
                <h4 id="public-sharing-active-title">{t("remote.active")}</h4>
                <span className="public-sharing-count" aria-label={`${links.length}`}>{links.length}</span>
              </div>
              {links.length === 0 ? (
                <div className="remote-enabled-empty">
                  <span><Icons.share aria-hidden="true" size={20} /></span>
                  <p>{t("remote.empty")}</p>
                </div>
              ) : (
                <div className="remote-enabled-list">
                  {links.map((link) => (
                    <div className="remote-enabled-item" key={link.id}>
                      <span className="remote-enabled-icon"><ScopeIcon scope={link.scope} /></span>
                      <div className="remote-enabled-copy">
                        <strong>{link.scope === "machine" ? t("remote.workspace") : link.name}</strong>
                        <div className="remote-enabled-meta">
                          <span className="remote-enabled-scope">{scopeLabel(link.scope, t)}</span>
                          <span className={`remote-enabled-status${link.ready ? "" : " is-pending"}`}>
                            <i aria-hidden="true" />
                            {t(link.ready ? "remote.active" : "remote.not_ready")}
                          </span>
                        </div>
                      </div>
                      <button
                        className="public-sharing-button remote-enabled-stop"
                        disabled={busy}
                        type="button"
                        onClick={() => void action(async () => {
                          await invoke("public_account_remote_disable", { id: link.id });
                          await refresh();
                        })}
                      >
                        {t("remote.disable")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </section>
  );
}
