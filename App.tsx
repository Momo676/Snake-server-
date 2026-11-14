import { useCallback, useEffect, useRef, useState } from 'react';
import { GameHud } from './components/GameHud';
import { GameModals } from './components/GameModals';
import { TitleOverlay } from './components/TitleOverlay';
import { XPayModal, type XPayMode } from './components/XPayModal';
import { soundEngine } from './game/audio';
import { SlitherEngine } from './game/engine';
import { canAffordRoom, roundEgp } from './game/rules';
import { PRESET_SKINS } from './game/skins';
import type {
  GamePhase,
  HudSnapshot,
  PhotoAnalysisResult,
  RoomStake,
  RunSummary,
  SkinDefinition,
} from './game/types';
import type { AppLanguage } from './i18n';

const INITIAL_HUD: HudSnapshot = {
  length: 300,
  kills: 0,
  rank: 1,
  totalSnakes: 17,
  canBoost: true,
  boostCharge: 30,
  roomStake: 25,
  potEgp: 25,
  leaderboard: [],
  killNotice: null,
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SlitherEngine | null>(null);

  const [phase, setPhase] = useState<GamePhase>('title');
  const [playerName, setPlayerName] = useState<string>('Bruhv');
  const [selectedSkin, setSelectedSkin] = useState<SkinDefinition>(PRESET_SKINS[0]);
  const [customSkin, setCustomSkin] = useState<SkinDefinition | null>(null);
  const [analysisResult, setAnalysisResult] = useState<PhotoAnalysisResult | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [muted, setMuted] = useState<boolean>(false);
  const [selectedRoom, setSelectedRoom] = useState<RoomStake>(25);
  const [xpayMode, setXpayMode] = useState<XPayMode | null>(null);
  const [lang, setLang] = useState<AppLanguage>(() => {
    try {
      return localStorage.getItem('damn_bruh_lang') === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });
  const [walletEgp, setWalletEgp] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('damn_bruh_wallet_egp');
      if (raw === null) return 100;
      const saved = Number(raw);
      return Number.isFinite(saved) && saved >= 0 ? roundEgp(saved) : 100;
    } catch {
      return 100;
    }
  });
  const [bestLength, setBestLength] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('damn_bruh_best_length') || '300');
      return Number.isFinite(saved) && saved >= 300 ? saved : 300;
    } catch {
      return 300;
    }
  });

  const updateWallet = useCallback((updater: (prev: number) => number) => {
    setWalletEgp((prev) => {
      const next = Math.max(0, roundEgp(updater(prev)));
      try {
        localStorage.setItem('damn_bruh_wallet_egp', String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  // Sync body[data-state] for game state visibility & testing
  useEffect(() => {
    document.body.dataset.state = phase;
  }, [phase]);

  // Sync document language / RTL direction and engine language
  useEffect(() => {
    document.documentElement.lang = lang === 'ar' ? 'ar-EG' : 'en';
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    engineRef.current?.setLanguage(lang);
    try {
      localStorage.setItem('damn_bruh_lang', lang);
    } catch {
      // Ignore storage errors
    }
  }, [lang]);

  const handleToggleLang = useCallback(() => {
    setLang((prev) => (prev === 'en' ? 'ar' : 'en'));
  }, []);

  const handleStartGame = useCallback(() => {
    if (!engineRef.current) return;
    if (!canAffordRoom(walletEgp, selectedRoom)) {
      setXpayMode('cashin');
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    updateWallet((prev) => prev - selectedRoom);
    setSummary(null);
    document.body.dataset.state = 'playing';
    setPhase('playing');
    engineRef.current.startNewRun(playerName, selectedSkin, selectedRoom);
    canvasRef.current?.focus();
  }, [playerName, selectedSkin, selectedRoom, walletEgp, updateWallet]);

  const handlePause = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.pause();
    setPhase('paused');
  }, []);

  const handleResume = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.resume();
    setPhase('playing');
    canvasRef.current?.focus();
  }, []);

  const handleBackToTitle = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.returnToTitle();
    setSummary(null);
    setPhase('title');
  }, []);

  const handleCashOutComplete = useCallback(() => {
    if (!engineRef.current) return;
    if (engineRef.current.isMultiplayerActive()) {
      // Server authoritatively validates the 3s hold and emits 'cashedOut'
      engineRef.current.setCashOutProgress(1);
      return;
    }
    const cashSummary = engineRef.current.cashOutRun();
    if (!cashSummary) return;
    updateWallet((prev) => prev + cashSummary.payoutEgp);
    setBestLength(cashSummary.bestLength);
    setSummary(cashSummary);
    setPhase('gameover');
  }, [updateWallet]);

  const handleToggleMute = useCallback(() => {
    const next = soundEngine.toggleMute();
    setMuted(next);
  }, []);

  const handleCashOutProgress = useCallback((progress: number) => {
    engineRef.current?.setCashOutProgress(progress);
  }, []);

  const handleRegisterMinimap = useCallback((mini: HTMLCanvasElement | null) => {
    engineRef.current?.setMinimapCanvas(mini);
  }, []);

  // Mount Canvas2D SlitherEngine once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new SlitherEngine(canvas, {
      onHudUpdate: (nextHud) => setHud(nextHud),
      onGameOver: (runSummary) => {
        if (runSummary.cashedOut) {
          updateWallet((prev) => prev + runSummary.payoutEgp);
        }
        setSummary(runSummary);
        setBestLength(runSummary.bestLength);
        setPhase('gameover');
      },
    });
    engineRef.current = engine;
    engine.setLanguage(lang);
    engine.startLoop();

    // Support ?autostart=1 to jump directly into active gameplay
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      document.body.dataset.state = 'playing';
      setPhase('playing');
      engine.startNewRun('Bruhv', PRESET_SKINS[0], 25);
      canvas.focus();
    }

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Global keyboard shortcuts (Enter/Space on Title, Esc/P for Pause, M for Mute)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (xpayMode !== null) {
        if (e.code === 'Escape') {
          setXpayMode(null);
        }
        return;
      }

      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (e.code === 'KeyM' && !isInput) {
        handleToggleMute();
        return;
      }

      if (phase === 'title') {
        if ((e.code === 'Enter' || e.code === 'Space') && !isInput) {
          e.preventDefault();
          handleStartGame();
        }
      } else if (phase === 'playing') {
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          handlePause();
        }
      } else if (phase === 'paused') {
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          handleResume();
        }
      } else if (phase === 'gameover') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStartGame();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, xpayMode, handleStartGame, handlePause, handleResume, handleToggleMute]);

  return (
    <div className="w-full h-dvh bg-[#070A10] flex items-center justify-center overflow-hidden">
      <div
        className="relative h-full w-full overflow-hidden bg-[#0B0F17] shadow-2xl border-x border-[#1E293B]/70"
        style={{ maxWidth: 'min(100vw, calc(100dvh * 9 / 16))' }}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          data-testid="arena-canvas"
          aria-label="Damn Bruh Slither Arena Canvas"
          className="block w-full h-full outline-none cursor-crosshair touch-none select-none"
        />

      {phase === 'title' && (
        <TitleOverlay
          lang={lang}
          onToggleLang={handleToggleLang}
          playerName={playerName}
          onPlayerNameChange={setPlayerName}
          selectedSkin={selectedSkin}
          onSelectSkin={setSelectedSkin}
          customSkin={customSkin}
          analysisResult={analysisResult}
          onAnalysisComplete={(res, skin) => {
            setAnalysisResult(res);
            setCustomSkin(skin);
            setSelectedSkin(skin);
          }}
          onStartGame={handleStartGame}
          bestLength={bestLength}
          walletEgp={walletEgp}
          selectedRoom={selectedRoom}
          onSelectRoom={(stake) => {
            setSelectedRoom(stake);
            engineRef.current?.setSpectateRoom(stake);
          }}
          onOpenXPay={(mode) => setXpayMode(mode)}
        />
      )}

      {phase === 'playing' && (
        <GameHud
          lang={lang}
          hud={hud}
          muted={muted}
          onToggleMute={handleToggleMute}
          onPause={handlePause}
          onCashOutComplete={handleCashOutComplete}
          onCashOutProgress={handleCashOutProgress}
          onRegisterMinimap={handleRegisterMinimap}
        />
      )}

      <GameModals
        lang={lang}
        onToggleLang={handleToggleLang}
        phase={phase}
        summary={summary}
        onResume={handleResume}
        onRestart={handleStartGame}
        onBackToTitle={handleBackToTitle}
      />

      {xpayMode && (
        <XPayModal
          lang={lang}
          mode={xpayMode}
          walletEgp={walletEgp}
          onClose={() => setXpayMode(null)}
          onConfirmCashIn={(amount) => updateWallet((prev) => prev + amount)}
          onConfirmCashOut={(amount) => updateWallet((prev) => prev - amount)}
        />
      )}
      </div>
    </div>
  );
}
