//! The conversation popover edits language preferences only; engines belong to global Settings.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Backdrop } from "../components/Backdrop";
import Select from "../components/Select";
import Icons from "../components/Icons";
import { Field } from "../components/Field";
import { useT } from "../i18n";
import type { TranslationPreferences } from "../ipc/translation";
import { useConversationTranslation } from "./state";
import { translationError } from "./SettingsSection";
import { followTranslationLink, navigateTranslation, settingsTranslationUrl, translationUrl, useTranslationRoute } from "./navigation";
import "./translation.css";

export function TranslationComposerControl() {
  const t = useT(); const state = useConversationTranslation(); const route = useTranslationRoute();
  const anchor = useRef<HTMLAnchorElement>(null); const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 8, left: 8 }); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const enabled = !!state?.settings?.config.enabled && !!state?.value?.enabled;
  const open = enabled && route.get("translation") === "languages" && route.get("translationSession") === state?.sessionId;
  const prefs = state?.value?.preferences;
  const href = translationUrl({ translation: "languages", translationSession: state?.sessionId ?? null });
  const close = () => { navigateTranslation(translationUrl({ translation: null, translationSession: null })); anchor.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => { const rect = anchor.current?.getBoundingClientRect(); const composer = anchor.current?.closest(".sv-composer")?.getBoundingClientRect(); const size = panel.current?.getBoundingClientRect();
      if (rect && size) setPosition({ top: Math.max(8, Math.min(rect.top - size.height - 12, window.innerHeight - size.height - 8)), left: Math.max(8, Math.min((composer?.right ?? rect.right) - size.width - 8, window.innerWidth - size.width - 8)) }); };
    update(); window.addEventListener("resize", update); return () => window.removeEventListener("resize", update);
  }, [open, prefs, error]);
  useEffect(() => { if (open) panel.current?.focus(); }, [open]);
  useEffect(() => { setError(""); }, [state?.sessionId]);
  useEffect(() => {
    if (state?.settings && !state.settings.config.enabled && route.get("translation") === "languages" && route.get("translationSession") === state.sessionId) navigateTranslation(settingsTranslationUrl());
  }, [state?.settings?.config.enabled, state?.sessionId, route.get("translation"), route.get("translationSession")]);
  if (!enabled || !prefs || !state?.settings) return null;
  const save = async (patch: Partial<TranslationPreferences>) => {
    if (busy) return false; setBusy(true); setError("");
    try { await state.save({ ...prefs, ...patch }); return true; }
    catch (e) { setError(translationError(e, t)); return false; }
    finally { setBusy(false); }
  };
  const cfg = state.settings.config;
  const configured = cfg.engine === "google" || (cfg.engine === "api" ? state.settings.services.some(s => s.id === cfg.serviceId) : state.settings.agents.some(s => s.id === cfg.agent && s.available));
  const languages = state.settings.languages.map(language => ({ value: language.code, label: language.name }));
  const sourceLanguages = [{ value: "auto", label: t("translation.auto") }, ...languages];
  const languageName = (code: string) => state.settings!.languages.find(language => language.code === code)?.name ?? code;
  const direction = prefs.target ? `${prefs.source === "auto" ? t("translation.auto") : languageName(prefs.source)} → ${languageName(prefs.target)}` : t("translation.languages");
  const toggleTranslation = (checked: boolean) => { void save({ outgoing: checked, replies: checked }); };
  const missingLanguage = (prefs.outgoing && !prefs.target) || (prefs.replies && !prefs.replyTarget);
  const canSwap = (reply: boolean) => reply ? prefs.replySource !== "auto" && !!prefs.replyTarget : prefs.source !== "auto" && !!prefs.target;
  const group = (reply: boolean) => <div className={`translation-language-grid${canSwap(reply) ? " translation-language-grid-swap" : ""}`}>
    <Field as="div" label={t("translation.source")}><Select value={reply ? prefs.replySource : prefs.source} onChange={source => void save(reply ? { replySource: source } : { source })} options={sourceLanguages} disabled={busy} width="100%" menuPortal ariaLabel={t(reply ? "translation.replySource" : "translation.source")} /></Field>
    <Field as="div" label={t("translation.target")}><Select value={reply ? prefs.replyTarget : prefs.target} onChange={target => void save(reply ? { replyTarget: target } : { target })} options={languages} disabled={busy} placeholder={t("translation.target")} width="100%" menuPortal ariaLabel={t(reply ? "translation.replyTarget" : "translation.target")} /></Field>
    {canSwap(reply) && <button className="sv-chip translation-swap" aria-label={t("translation.swap")} title={t("translation.swap")} onClick={() => void save(reply ? { replySource: prefs.replyTarget, replyTarget: prefs.replySource } : { source: prefs.target, target: prefs.source })} disabled={busy}><Icons.arrowRight size={12} /><Icons.arrowLeft size={12} /></button>}
  </div>;
  return <div className="translation-composer-controls">
    <label className="translation-toggle translation-composer-toggle" title={t("translation.title")}>
      <input type="checkbox" role="switch" aria-label={t("translation.title")} checked={prefs.outgoing || prefs.replies} disabled={busy} onChange={e => toggleTranslation(e.target.checked)} />
      <span>{t("translation.title")}</span>
    </label>
    <a className="sv-chip translation-direction" ref={anchor} href={href} onClick={followTranslationLink} aria-expanded={open} title={t("translation.languages")}><span>{direction}</span><Icons.chevronDown size={12} /></a>
    {!open && error && <span className="translation-composer-notice translation-hint" role="alert">{error}</span>}
    {!open && !error && missingLanguage && <span className="translation-composer-notice translation-hint" role="status"><a href={href} onClick={followTranslationLink}>{t("translation.chooseTarget")}</a></span>}
    {!open && !error && !missingLanguage && !configured && (prefs.outgoing || prefs.replies) && <span className="translation-composer-notice translation-hint" role="status"><a href={settingsTranslationUrl()} onClick={followTranslationLink}>{t("translation.configure")}</a></span>}
    {open && createPortal(<Backdrop dim={false} center={false} onClose={close}><div className="translation-popover sv-popover" ref={panel} role="dialog" aria-label={t("translation.languages")} tabIndex={-1}
      style={{ position: "fixed", ...position }} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <div className="translation-popover-heading"><strong>{t("translation.title")}</strong><button className="sv-chip" aria-label={t("common.close")} onClick={close}><Icons.close size={14} /></button></div>
      {!configured && <a href={settingsTranslationUrl()} onClick={followTranslationLink}>{t("translation.configure")}</a>}
      <div className="translation-popover-group">{group(false)}</div>
      <div className="translation-popover-group"><label className="translation-toggle"><span>{t("translation.replies")}</span><input type="checkbox" role="switch" checked={prefs.replies} disabled={busy} onChange={e => void save({ replies: e.target.checked })} /></label>{group(true)}</div>
      <div className="translation-popover-group translation-display-field"><span>{t("translation.replyDisplay")}</span><Select value={prefs.display} options={state.settings.displays.map(display => ({ value: display, label: t(`translation.${display}`) }))} onChange={display => void save({ display })} disabled={busy} menuPortal width="140px" ariaLabel={t("translation.replyDisplay")} /></div>
      {missingLanguage && <p className="translation-hint" role="status">{t("translation.chooseTarget")}</p>}
      {error && <p className="translation-hint" role="alert">{error}</p>}
      <div className="translation-popover-footer"><a className="vlx-btn translation-more-settings" href={settingsTranslationUrl()} onClick={followTranslationLink}><Icons.gear size={14} />{t("translation.moreSettings")}</a></div>
    </div></Backdrop>, document.body)}
  </div>;
}
