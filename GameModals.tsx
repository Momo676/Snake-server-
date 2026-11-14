import React from 'react';
import { Globe, Play, RotateCcw, Home } from 'lucide-react';
import { formatEgp } from '../game/rules';
import type { GamePhase, RunSummary } from '../game/types';
import { COPY, getCurrencyUnit, type AppLanguage } from '../i18n';

interface GameModalsProps {
  lang: AppLanguage;
  onToggleLang: () => void;
  phase: GamePhase;
  summary: RunSummary | null;
  onResume: () => void;
  onRestart: () => void;
  onBackToTitle: () => void;
}

export const GameModals: React.FC<GameModalsProps> = ({
  lang,
  onToggleLang,
  phase,
  summary,
  onResume,
  onRestart,
  onBackToTitle,
}) => {
  const t = COPY[lang];
  const currency = getCurrencyUnit(lang);

  if (phase === 'paused') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-modal-title"
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-[#0B0F17]/75"
      >
        <div className="w-full max-w-sm bg-[#111722] border border-[#243044] rounded-xl p-6 shadow-2xl space-y-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2
                id="pause-modal-title"
                className="font-display text-2xl font-bold text-slate-50"
              >
                {t.pausedTitle}
              </h2>
              <p className="text-xs text-slate-400 mt-1">{t.pausedHint}</p>
            </div>
            <button
              type="button"
              onClick={onToggleLang}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0B0F17] border border-[#243044] hover:border-[#A3E635] text-xs font-semibold text-slate-200 transition-colors cursor-pointer shrink-0"
            >
              <Globe className="w-3.5 h-3.5 text-[#38BDF8]" aria-hidden="true" />
              {t.langSwitchLabel}
            </button>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={onResume}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#A3E635] hover:bg-[#BEF264] text-[#0B0F17] font-display font-bold text-sm transition-colors cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              {t.resumeArena}
            </button>

            <button
              type="button"
              onClick={onRestart}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#182234] border border-[#2A374E] hover:border-[#A3E635] text-slate-100 font-semibold text-sm transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              {t.restartRun}
            </button>

            <button
              type="button"
              onClick={onBackToTitle}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0B0F17] border border-[#243044] hover:border-slate-500 text-slate-300 font-medium text-sm transition-colors cursor-pointer"
            >
              <Home className="w-4 h-4" aria-hidden="true" />
              {t.backLobby}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'gameover' && summary) {
    const defeatedLabel =
      summary.defeatedBy === 'Arena Perimeter' ? t.arenaPerimeter : summary.defeatedBy;

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gameover-modal-title"
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-[#0B0F17]/80"
      >
        <div className="w-full max-w-md bg-[#111722] border border-[#243044] rounded-xl p-6 shadow-2xl space-y-5">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2
                id="gameover-modal-title"
                className={`font-display text-2xl sm:text-3xl font-extrabold ${
                  summary.cashedOut ? 'text-[#A3E635]' : 'text-[#F43F5E]'
                }`}
              >
                {summary.cashedOut ? t.cashedOutTitle : t.deathTitle}
              </h2>
              {summary.isNewBest && (
                <span className="text-xs font-bold text-[#FBBF24] shrink-0">
                  {t.newBest}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-300 mt-1">
              {summary.cashedOut ? (
                <>
                  {t.securedPrefix}{' '}
                  <span className="font-mono-tabular font-bold text-[#A3E635]">
                    +{formatEgp(summary.payoutEgp)} {currency}
                  </span>{' '}
                  {t.securedMid} · {summary.survivedSeconds}
                  {t.secUnit}
                </>
              ) : (
                <>
                  {t.eliminatedBy}{' '}
                  <span className="font-semibold text-slate-100">
                    {defeatedLabel}
                  </span>{' '}
                  · {t.lostStakePrefix} {summary.roomStake} {currency}
                  {t.lostStakeSuffix ? ` ${t.lostStakeSuffix}` : ''}
                </>
              )}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            <div className="bg-[#0B0F17] border border-[#222D40] rounded-lg p-3 flex flex-col justify-between">
              <div className="text-[11px] font-semibold text-slate-400 whitespace-nowrap">
                {t.length}
              </div>
              <div className="font-mono-tabular text-2xl font-bold text-[#A3E635] mt-1">
                {summary.finalLength}
              </div>
            </div>

            <div className="bg-[#0B0F17] border border-[#222D40] rounded-lg p-3 flex flex-col justify-between">
              <div className="text-[11px] font-semibold text-slate-400 whitespace-nowrap">
                {t.peakRank}
              </div>
              <div className="font-mono-tabular text-2xl font-bold text-slate-100 mt-1">
                #{summary.peakRank}
              </div>
            </div>

            <div className="bg-[#0B0F17] border border-[#222D40] rounded-lg p-3 flex flex-col justify-between">
              <div className="text-[11px] font-semibold text-slate-400 whitespace-nowrap">
                {t.elims}
              </div>
              <div className="font-mono-tabular text-2xl font-bold text-[#FBBF24] mt-1">
                {summary.kills}
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-400 flex items-center justify-between">
            <span>
              {t.peakRunLength}{' '}
              <strong className="font-mono-tabular text-slate-200">
                {summary.peakLength}
              </strong>
            </span>
            <span>
              {t.allTimeBest}{' '}
              <strong className="font-mono-tabular text-slate-200">
                {summary.bestLength}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              data-start="true"
              onClick={onRestart}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-[#A3E635] hover:bg-[#BEF264] text-[#0B0F17] font-display font-bold text-sm transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              {t.playAgain}
            </button>
            <button
              type="button"
              onClick={onBackToTitle}
              className="px-4 py-3 rounded-lg bg-[#0B0F17] border border-[#243044] hover:border-slate-500 text-slate-200 font-medium text-sm transition-colors cursor-pointer"
            >
              {t.changeSkin}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
