import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Pause, LogOut } from 'lucide-react';
import { CASH_OUT_HOLD_MS, formatEgp } from '../game/rules';
import type { HudSnapshot } from '../game/types';
import { COPY, getCurrencyUnit, type AppLanguage } from '../i18n';

interface GameHudProps {
  lang: AppLanguage;
  hud: HudSnapshot;
  muted: boolean;
  onToggleMute: () => void;
  onPause: () => void;
  onCashOutComplete: () => void;
  onCashOutProgress: (progress: number) => void;
  onRegisterMinimap: (canvas: HTMLCanvasElement | null) => void;
}

export const GameHud: React.FC<GameHudProps> = ({
  lang,
  hud,
  muted,
  onToggleMute,
  onPause,
  onCashOutComplete,
  onCashOutProgress,
  onRegisterMinimap,
}) => {
  const t = COPY[lang];
  const currency = getCurrencyUnit(lang);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef<number | null>(null);
  const completedRef = useRef<boolean>(false);
  const [holdProgress, setHoldProgress] = useState<number>(0);
  const [isHoldingCashOut, setIsHoldingCashOut] = useState<boolean>(false);

  useEffect(() => {
    onRegisterMinimap(minimapRef.current);
    return () => onRegisterMinimap(null);
  }, [onRegisterMinimap]);

  const stopHoldCashOut = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdStartRef.current = null;
    setIsHoldingCashOut(false);
    setHoldProgress(0);
    onCashOutProgress(0);
  }, [onCashOutProgress]);

  const beginHoldCashOut = useCallback(() => {
    if (holdTimerRef.current !== null) return;
    completedRef.current = false;
    holdStartRef.current = performance.now();
    setIsHoldingCashOut(true);
    setHoldProgress(0.01);
    onCashOutProgress(0.01);

    holdTimerRef.current = window.setInterval(() => {
      if (holdStartRef.current === null || completedRef.current) return;
      const elapsed = performance.now() - holdStartRef.current;
      const pct = Math.min(1, elapsed / CASH_OUT_HOLD_MS);
      setHoldProgress(pct);
      onCashOutProgress(pct);
      if (elapsed >= CASH_OUT_HOLD_MS) {
        completedRef.current = true;
        if (holdTimerRef.current !== null) {
          window.clearInterval(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        holdStartRef.current = null;
        onCashOutComplete();
      }
    }, 16);
  }, [onCashOutComplete, onCashOutProgress]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyQ' && !e.repeat) {
        e.preventDefault();
        beginHoldCashOut();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyQ' && !completedRef.current) {
        stopHoldCashOut();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', stopHoldCashOut);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stopHoldCashOut);
      if (holdTimerRef.current !== null) {
        window.clearInterval(holdTimerRef.current);
      }
      if (!completedRef.current) {
        onCashOutProgress(0);
      }
    };
  }, [beginHoldCashOut, stopHoldCashOut, onCashOutProgress]);

  const startPointerCashOut = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    beginHoldCashOut();
  };

  const remainingSec = Math.max(0, ((1 - holdProgress) * CASH_OUT_HOLD_MS) / 1000).toFixed(1);

  return (
    <div
      dir="ltr"
      className="absolute inset-0 z-10 pointer-events-none p-3 flex flex-col justify-between"
    >
      {/* Top Row: Left Stats Cluster + Right Leaderboard & Utility Controls */}
      <div className="flex items-start justify-between gap-2">
        {/* Top-Left Cluster: Length, Rank, Elims, Pot & Boost Energy */}
        <div
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          className="bg-[#111722]/90 border border-[#243044] rounded-lg px-2.5 py-2 min-w-[132px]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-slate-400">
                {t.length}
              </div>
              <div
                data-testid="hud-length"
                className="font-mono-tabular text-2xl font-bold leading-none text-[#A3E635] hud-text-stroke mt-0.5"
              >
                {hud.length}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-semibold tracking-wider text-slate-400">
                {t.rank}
              </div>
              <div className="font-mono-tabular text-sm font-bold text-slate-100 mt-0.5">
                #{hud.rank}
                <span className="text-[11px] font-normal text-slate-400">
                  /{hud.totalSnakes}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-2 pt-2 border-t border-[#1E293B] flex items-center justify-between text-[11px] gap-2">
            <span className="text-slate-400 whitespace-nowrap">
              {t.pot}{' '}
              <span
                data-testid="hud-pot"
                className="font-mono-tabular font-bold text-[#FBBF24]"
              >
                {formatEgp(hud.potEgp)} {currency}
              </span>
            </span>
            <span className="text-slate-400 whitespace-nowrap">
              {t.elims}{' '}
              <span className="font-mono-tabular font-bold text-slate-100">
                {hud.kills}
              </span>
            </span>
          </div>

          <div className="mt-1.5 h-1.5 w-full rounded-full bg-[#0B0F17] overflow-hidden">
            <div
              className={`h-full transition-transform duration-100 origin-left ${
                hud.canBoost ? 'bg-[#A3E635]' : 'bg-slate-600'
              }`}
              style={{ transform: `scaleX(${Math.max(0.05, hud.boostCharge / 100)})` }}
            />
          </div>
        </div>

        {/* Top-Right Cluster: Leaderboard + Utility Buttons */}
        <div className="flex items-start gap-2">
          <div
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            data-testid="hud-leaderboard"
            className="bg-[#111722]/90 border border-[#243044] rounded-lg px-2.5 py-2 w-[152px]"
          >
            <div className="text-[10px] font-semibold tracking-wider text-slate-400 mb-1 flex items-center justify-between gap-2">
              <span>{t.top5}</span>
              <span className="text-[#FBBF24] whitespace-nowrap">
                {hud.roomStake} {currency}
              </span>
            </div>
            <ol className="space-y-0.5">
              {hud.leaderboard.map((entry) => (
                <li
                  key={entry.id}
                  className={`flex items-center justify-between gap-1.5 text-[11px] ${
                    entry.isPlayer ? 'text-[#A3E635] font-bold' : 'text-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="font-mono-tabular text-slate-400 w-3.5 shrink-0">
                      {entry.rank}.
                    </span>
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: entry.accentColor }}
                      aria-hidden="true"
                    />
                    <span className="truncate" dir="ltr">{entry.name}</span>
                  </span>
                  <span className="font-mono-tabular shrink-0">{entry.length}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-1.5 pointer-events-auto">
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              aria-label={muted ? t.unmuteAria : t.muteAria}
              title={muted ? t.unmuteAria : t.muteAria}
              className="w-9 h-9 rounded-lg bg-[#111722]/95 border border-[#243044] hover:border-[#A3E635] flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
            >
              {muted ? (
                <VolumeX className="w-4 h-4 text-[#F43F5E]" aria-hidden="true" />
              ) : (
                <Volume2 className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              aria-label={t.pauseAria}
              title={t.pauseAria}
              className="w-9 h-9 rounded-lg bg-[#111722]/95 border border-[#243044] hover:border-[#A3E635] flex items-center justify-center text-slate-200 transition-colors cursor-pointer"
            >
              <Pause className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Row: Hold Q or 3s to Cash Out Button + Radar Minimap */}
      <div className="flex items-end justify-between gap-4">
        <button
          type="button"
          tabIndex={-1}
          dir={lang === 'ar' ? 'rtl' : 'ltr'}
          data-testid="cashout-hold-btn"
          onPointerDown={startPointerCashOut}
          onPointerUp={(e) => {
            e.stopPropagation();
            stopHoldCashOut();
          }}
          onPointerCancel={stopHoldCashOut}
          onPointerLeave={stopHoldCashOut}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={`${t.holdCashOut} ${formatEgp(hud.potEgp)} ${currency}`}
          className="relative overflow-hidden pointer-events-auto touch-none select-none rounded-lg bg-[#111722]/95 border border-[#38BDF8]/70 hover:border-[#38BDF8] px-3.5 py-2.5 min-w-[162px] text-start cursor-pointer shadow-lg"
        >
          {/* 3-second fill progress bar */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[#38BDF8]/30 origin-left transition-transform duration-75"
            style={{ transform: `scaleX(${holdProgress})` }}
          />
          <div className="relative flex items-center gap-2.5">
            <LogOut className="w-4 h-4 text-[#38BDF8] shrink-0" aria-hidden="true" />
            <div>
              <div className="text-xs font-display font-bold text-slate-100 whitespace-nowrap">
                {isHoldingCashOut
                  ? `${t.cashingOut} (${remainingSec}${t.secUnit})`
                  : t.holdCashOut}
              </div>
              <div className="font-mono-tabular text-xs font-bold text-[#A3E635]">
                {formatEgp(hud.potEgp)} {currency}
              </div>
            </div>
          </div>
        </button>

        <div className="flex flex-col items-end gap-1">
          <canvas
            ref={minimapRef}
            width={128}
            height={128}
            aria-label="Arena radar minimap"
            className="w-[104px] h-[104px] rounded-full"
          />
        </div>
      </div>
    </div>
  );
};
