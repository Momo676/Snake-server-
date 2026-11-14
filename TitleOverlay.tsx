import React, { useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Globe,
  ImagePlus,
  Loader2,
  Play,
  RotateCcw,
} from 'lucide-react';
import { canAffordRoom, formatEgp, ROOM_STAKES } from '../game/rules';
import { getSegmentColor, PRESET_SKINS } from '../game/skins';
import type { PhotoAnalysisResult, RoomStake, SkinDefinition } from '../game/types';
import {
  COPY,
  EYE_LABELS_AR,
  getCurrencyUnit,
  PATTERN_LABELS_AR,
  SKIN_TRANSLATIONS,
  type AppLanguage,
} from '../i18n';
import { resizeImageFileToDataUrl } from '../utils/imageResize';

interface TitleOverlayProps {
  lang: AppLanguage;
  onToggleLang: () => void;
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  selectedSkin: SkinDefinition;
  onSelectSkin: (skin: SkinDefinition) => void;
  customSkin: SkinDefinition | null;
  analysisResult: PhotoAnalysisResult | null;
  onAnalysisComplete: (result: PhotoAnalysisResult, skin: SkinDefinition) => void;
  onStartGame: () => void;
  bestLength: number;
  walletEgp: number;
  selectedRoom: RoomStake;
  onSelectRoom: (stake: RoomStake) => void;
  onOpenXPay: (mode: 'cashin' | 'cashout') => void;
}

function SkinSegmentStrip({ skin, size = 14 }: { skin: SkinDefinition; size?: number }) {
  const count = 8;
  return (
    <span className="inline-flex items-center" dir="ltr" aria-hidden="true">
      {Array.from({ length: count }).map((_, idx) => {
        const color = getSegmentColor(skin, idx, count);
        return (
          <span
            key={idx}
            className="rounded-full border border-[#0B0F17] -ml-1.5 first:ml-0"
            style={{
              width: `${size}px`,
              height: `${size}px`,
              backgroundColor: color,
              zIndex: count - idx,
            }}
          />
        );
      })}
    </span>
  );
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  lang,
  onToggleLang,
  playerName,
  onPlayerNameChange,
  selectedSkin,
  onSelectSkin,
  customSkin,
  analysisResult,
  onAnalysisComplete,
  onStartGame,
  bestLength,
  walletEgp,
  selectedRoom,
  onSelectRoom,
  onOpenXPay,
}) => {
  const t = COPY[lang];
  const currency = getCurrencyUnit(lang);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(
    analysisResult?.previewDataUrl || null,
  );
  const [uploadedMime, setUploadedMime] = useState<string>('image/jpeg');
  const [promptHint, setPromptHint] = useState<string>('');
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const getSkinLabel = (skin: SkinDefinition) => {
    const tr = SKIN_TRANSLATIONS[skin.id];
    if (lang === 'ar' && tr) {
      return { name: tr.arName, trait: tr.arTrait };
    }
    return { name: skin.name, trait: skin.trait || skin.pattern };
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const { dataUrl, mimeType } = await resizeImageFileToDataUrl(file, 960);
      setUploadedPreview(dataUrl);
      setUploadedMime(mimeType);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load photo.');
    }
  };

  const handleAnalyzePhoto = async () => {
    if (!uploadedPreview) {
      setErrorMsg(t.choosePhotoFirst);
      return;
    }
    setAnalyzing(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: uploadedPreview,
          mimeType: uploadedMime,
          promptHint: promptHint.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || t.networkAnalyzeErr);
        return;
      }

      const forgedSkin: SkinDefinition = {
        id: 'custom-photo-skin',
        name: data.title,
        colors: data.palette,
        pattern: data.pattern,
        eyeStyle: data.eyeStyle,
        trait: data.trait,
        isCustom: true,
      };

      const fullResult: PhotoAnalysisResult = {
        model: data.model,
        title: data.title,
        description: data.description,
        palette: data.palette,
        pattern: data.pattern,
        eyeStyle: data.eyeStyle,
        trait: data.trait,
        previewDataUrl: uploadedPreview,
      };

      onAnalysisComplete(fullResult, forgedSkin);
    } catch {
      setErrorMsg(t.networkAnalyzeErr);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleClearPhoto = () => {
    setUploadedPreview(null);
    setErrorMsg(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const availableSkins = customSkin ? [customSkin, ...PRESET_SKINS] : PRESET_SKINS;
  const activeSkinLabel = getSkinLabel(selectedSkin);
  const activePatternLabel =
    lang === 'ar' ? PATTERN_LABELS_AR[selectedSkin.pattern] : selectedSkin.pattern;

  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="absolute inset-0 z-20 flex flex-col justify-between p-4 sm:p-5 overflow-y-auto"
      style={{
        background:
          'radial-gradient(circle at 50% 45%, rgba(11, 15, 23, 0.58) 0%, rgba(11, 15, 23, 0.84) 100%)',
      }}
    >
      {/* Top Safe Area: Language Switcher + Bespoke SVG Serpent Title Lockup */}
      <header className="w-full max-w-lg mx-auto flex flex-col items-center pt-1">
        <div className="w-full flex justify-end mb-1">
          <button
            type="button"
            data-testid="lang-toggle-btn"
            onClick={onToggleLang}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#111722]/90 border border-[#243044] hover:border-[#A3E635] text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-[#38BDF8]" aria-hidden="true" />
            {t.langSwitchLabel}
          </button>
        </div>

        <div className="flex items-center gap-3.5" dir="ltr">
          <svg
            viewBox="0 0 64 64"
            className="w-10 h-10 sm:w-12 sm:h-12 shrink-0"
            aria-hidden="true"
          >
            <path
              d="M12 48 C 12 28, 30 34, 32 22 C 34 10, 50 14, 52 24"
              fill="none"
              stroke="#070A10"
              strokeWidth="16"
              strokeLinecap="round"
            />
            <path
              d="M12 48 C 12 28, 30 34, 32 22 C 34 10, 50 14, 52 24"
              fill="none"
              stroke="#A3E635"
              strokeWidth="11"
              strokeLinecap="round"
            />
            <circle cx="52" cy="24" r="8" fill="#A3E635" stroke="#070A10" strokeWidth="2.5" />
            <circle cx="54" cy="21" r="2.2" fill="#FFFFFF" />
            <circle cx="54.7" cy="21" r="1.1" fill="#0B0F17" />
            <path d="M59 25 L64 23 M59 26 L64 28" stroke="#F43F5E" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-50 hud-text-stroke">
            {t.title}
          </h1>
        </div>
        <p className="mt-1.5 text-xs sm:text-sm text-slate-300 text-center">
          {t.subtitle}{' '}
          <span className="font-mono-tabular font-bold text-[#A3E635]">
            {bestLength}
          </span>
        </p>
      </header>

      {/* Main Centered Vertical Stack */}
      <main className="w-full max-w-lg mx-auto my-auto py-3 grid grid-cols-1 gap-4 items-stretch">
        {/* Top Card: Arena Entry, XPay Wallet, 3 EGP Rooms & Skin Loadout */}
        <section
          aria-label="Arena setup"
          className="bg-[#111722]/95 border border-[#243044] rounded-xl p-4 sm:p-5 flex flex-col justify-between shadow-2xl"
        >
          <div className="space-y-4">
            {/* XPay Preview Wallet Strip */}
            <div className="bg-[#0B0F17] border border-[#222D40] rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-sm font-extrabold text-[#38BDF8]">
                    xPay
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {t.previewWallet}
                  </span>
                </div>
                <div
                  data-testid="wallet-balance"
                  className="font-mono-tabular text-lg font-bold text-[#A3E635] leading-tight"
                >
                  {formatEgp(walletEgp)} {currency}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenXPay('cashin')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#182234] border border-[#38BDF8]/50 hover:border-[#38BDF8] text-xs font-semibold text-slate-100 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ArrowDownLeft className="w-3.5 h-3.5 text-[#38BDF8]" aria-hidden="true" />
                  {t.cashIn}
                </button>
                <button
                  type="button"
                  onClick={() => onOpenXPay('cashout')}
                  disabled={walletEgp <= 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#0B0F17] border border-[#2A374E] hover:border-slate-400 disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-300" aria-hidden="true" />
                  {t.cashOut}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="player-name-input"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                {t.callsignLabel}
              </label>
              <input
                id="player-name-input"
                type="text"
                maxLength={16}
                value={playerName}
                onChange={(e) => onPlayerNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onStartGame();
                  }
                }}
                placeholder={t.callsignPlaceholder}
                className="w-full bg-[#0B0F17] border border-[#2A374E] focus:border-[#A3E635] focus:outline-none rounded-lg px-3.5 py-2 text-base font-medium text-slate-100 placeholder:text-slate-500 transition-colors"
              />
            </div>

            {/* 3 Stake Rooms: 25, 50, 100 */}
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <span className="text-xs font-semibold text-slate-300">
                  {t.selectRoom}
                </span>
                <span className="text-[11px] text-slate-400 text-end">
                  {t.roomHint}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {ROOM_STAKES.map((stake) => {
                  const active = selectedRoom === stake;
                  const affordable = canAffordRoom(walletEgp, stake);
                  return (
                    <button
                      key={stake}
                      type="button"
                      onClick={() => onSelectRoom(stake)}
                      aria-label={`Select ${stake} EGP room`}
                      aria-pressed={active}
                      className={`px-2.5 py-2 rounded-lg border text-start transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#182234] border-[#A3E635] text-slate-50'
                          : 'bg-[#0B0F17] border-[#222D40] text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <div className="font-mono-tabular text-sm font-bold text-slate-100">
                        {stake} {currency}
                      </div>
                      <div className={`text-[11px] ${affordable ? 'text-slate-400' : 'text-[#F43F5E]'}`}>
                        {affordable ? `+${stake} ${currency} ${t.dropSuffix}` : t.lowBalance}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300">
                  {t.selectSkin}
                </span>
                <span className="text-xs text-slate-400">
                  {activeSkinLabel.name} · {activePatternLabel}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {availableSkins.map((skin) => {
                  const active = selectedSkin.id === skin.id;
                  const label = getSkinLabel(skin);
                  return (
                    <button
                      key={skin.id}
                      type="button"
                      onClick={() => onSelectSkin(skin)}
                      aria-label={`Select ${skin.name} skin`}
                      aria-pressed={active}
                      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-start transition-colors min-h-[44px] ${
                        active
                          ? 'bg-[#182234] border-[#A3E635] text-slate-50'
                          : 'bg-[#0B0F17] border-[#222D40] text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {label.name}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {label.trait}
                        </div>
                      </div>
                      <SkinSegmentStrip skin={skin} size={13} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#1E293B] flex items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              {canAffordRoom(walletEgp, selectedRoom) ? (
                <>
                  <span className="text-slate-200 font-medium">{t.entryLabel}</span>{' '}
                  <span className="font-mono-tabular text-[#A3E635] font-semibold">
                    {selectedRoom} {currency}
                  </span>{' '}
                  · {activeSkinLabel.name}
                </>
              ) : (
                <span className="text-[#FDA4AF]">
                  {t.needBalancePrefix} {selectedRoom} {currency} {t.needBalanceSuffix}
                </span>
              )}
            </div>
            <button
              type="button"
              data-start="true"
              disabled={!canAffordRoom(walletEgp, selectedRoom)}
              onClick={onStartGame}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-[#A3E635] hover:bg-[#BEF264] disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.99] text-[#0B0F17] font-display font-bold text-base transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              {t.play} ({selectedRoom} {currency})
            </button>
          </div>
        </section>

        {/* Bottom Card: Photo Upload & Gemini Image Understanding */}
        <section
          aria-label="Photo Skin Studio"
          className="bg-[#111722]/95 border border-[#243044] rounded-xl p-4 sm:p-5 flex flex-col justify-between shadow-2xl"
        >
          <div className="space-y-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-100">
                  {t.studioTitle}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t.studioDesc}
                </p>
              </div>
              {uploadedPreview && (
                <button
                  type="button"
                  onClick={handleClearPhoto}
                  aria-label={t.clearPhotoLabel}
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-[#1A2333] transition-colors"
                >
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              id="photo-upload-input"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="sr-only"
            />

            {!uploadedPreview ? (
              <label
                htmlFor="photo-upload-input"
                className="flex flex-col items-center justify-center gap-2 border border-dashed border-[#334155] hover:border-[#A3E635] bg-[#0B0F17] rounded-lg px-4 py-6 cursor-pointer transition-colors text-center"
              >
                <ImagePlus className="w-6 h-6 text-[#A3E635]" aria-hidden="true" />
                <span className="text-sm font-medium text-slate-200">
                  {t.uploadPhoto}
                </span>
                <span className="text-xs text-slate-400">
                  {t.uploadSub}
                </span>
              </label>
            ) : (
              <div className="space-y-3">
                <div className="relative rounded-lg overflow-hidden border border-[#243044] bg-[#0B0F17] h-32">
                  <img
                    src={uploadedPreview}
                    alt="Uploaded photo preview"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <label
                    htmlFor="photo-upload-input"
                    className="absolute bottom-2 right-2 px-2.5 py-1 rounded-md bg-[#0B0F17]/90 border border-[#334155] text-xs font-medium text-slate-200 hover:border-[#A3E635] cursor-pointer transition-colors"
                  >
                    {t.replacePhoto}
                  </label>
                </div>

                <div>
                  <label
                    htmlFor="photo-focus-input"
                    className="block text-[11px] font-medium text-slate-400 mb-1"
                  >
                    {t.styleNoteLabel}
                  </label>
                  <input
                    id="photo-focus-input"
                    type="text"
                    maxLength={60}
                    value={promptHint}
                    onChange={(e) => setPromptHint(e.target.value)}
                    placeholder={t.styleNotePlaceholder}
                    className="w-full bg-[#0B0F17] border border-[#243044] focus:border-[#A3E635] focus:outline-none rounded-md px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
                  />
                </div>
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="rounded-lg border border-[#F43F5E]/40 bg-[#F43F5E]/10 px-3 py-2 text-xs text-[#FDA4AF]"
              >
                {errorMsg}
              </div>
            )}

            {analysisResult && !errorMsg && (
              <div className="rounded-lg border border-[#243044] bg-[#0B0F17] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-100 truncate">
                    {analysisResult.title}
                  </span>
                  <div className="flex items-center gap-1 shrink-0" aria-label="Extracted palette">
                    {analysisResult.palette.map((hex, i) => (
                      <span
                        key={i}
                        className="w-3.5 h-3.5 rounded-sm border border-[#1E293B]"
                        style={{ backgroundColor: hex }}
                        title={hex}
                      />
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {analysisResult.description}
                </p>
                <div className="text-[11px] text-slate-400">
                  {lang === 'ar'
                    ? `${PATTERN_LABELS_AR[analysisResult.pattern]} · عيون ${EYE_LABELS_AR[analysisResult.eyeStyle]} · ${analysisResult.trait}`
                    : `${analysisResult.pattern} pattern · ${analysisResult.eyeStyle} eyes · ${analysisResult.trait}`}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleAnalyzePhoto}
            disabled={!uploadedPreview || analyzing}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#334155] bg-[#182234] hover:border-[#A3E635] disabled:opacity-45 disabled:cursor-not-allowed text-sm font-semibold text-slate-100 transition-colors cursor-pointer"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                {t.analyzingPhoto}
              </>
            ) : (
              t.analyzePhoto
            )}
          </button>
        </section>
      </main>

      {/* Bottom Safe Margin: Flat control hint */}
      <footer className="w-full text-center pb-1">
        <p className="text-xs text-slate-400">{t.footerHint}</p>
      </footer>
    </div>
  );
};
