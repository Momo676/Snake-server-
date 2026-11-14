import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, X } from 'lucide-react';
import { formatEgp, roundEgp } from '../game/rules';
import { COPY, getCurrencyUnit, type AppLanguage } from '../i18n';

export type XPayMode = 'cashin' | 'cashout';

interface XPayModalProps {
  lang: AppLanguage;
  mode: XPayMode;
  walletEgp: number;
  onClose: () => void;
  onConfirmCashIn: (amount: number, method: string, reference: string) => void;
  onConfirmCashOut: (amount: number, method: string, destination: string) => void;
}

const CASH_IN_PRESETS = [25, 50, 100, 250];

export const XPayModal: React.FC<XPayModalProps> = ({
  lang,
  mode,
  walletEgp,
  onClose,
  onConfirmCashIn,
  onConfirmCashOut,
}) => {
  const t = COPY[lang];
  const currency = getCurrencyUnit(lang);
  const [amountInput, setAmountInput] = useState<string>(
    mode === 'cashin' ? '100' : formatEgp(Math.min(100, Math.max(1, walletEgp))),
  );
  const [method, setMethod] = useState<string>('Vodafone Cash / Wallet');
  const [accountRef, setAccountRef] = useState<string>('0100 000 0000');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const parsedAmount = roundEgp(Number(amountInput));

  const getMethodLabel = (val: string) => {
    if (val === 'Vodafone Cash / Wallet') return t.channelVodafone;
    if (val === 'InstaPay Egypt') return t.channelInstaPay;
    return t.channelMeeza;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError(t.errInvalidAmount);
      return;
    }

    const methodDisplay = getMethodLabel(method);

    if (mode === 'cashin') {
      if (parsedAmount > 10000) {
        setError(t.errMaxAmount);
        return;
      }
      onConfirmCashIn(parsedAmount, method, accountRef.trim() || 'Preview');
      setReceipt(
        `${t.receiptCashInPrefix} +${formatEgp(parsedAmount)} ${currency} ${t.receiptVia} (${methodDisplay}) ${t.receiptCashInDone}`,
      );
      return;
    }

    if (parsedAmount > walletEgp) {
      setError(`${t.errInsufficient} ${formatEgp(walletEgp)} ${currency}.`);
      return;
    }

    onConfirmCashOut(parsedAmount, method, accountRef.trim() || 'Preview');
    setReceipt(
      `${t.receiptCashOutPrefix} ${formatEgp(parsedAmount)} ${currency} ${t.receiptVia} (${methodDisplay}) ${t.receiptCashOutDone}`,
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="xpay-modal-title"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-[#0B0F17]/80"
    >
      <div className="w-full max-w-md bg-[#111722] border border-[#243044] rounded-xl p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-xl font-extrabold tracking-tight text-[#38BDF8]">
                xPay
              </span>
              <span className="text-xs font-medium text-slate-400">
                {t.xpayBadge}
              </span>
            </div>
            <h2
              id="xpay-modal-title"
              className="font-display text-lg font-bold text-slate-100 mt-1"
            >
              {mode === 'cashin' ? t.xpayCashInTitle : t.xpayCashOutTitle}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close XPay preview"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#182234] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="bg-[#0B0F17] border border-[#222D40] rounded-lg px-3.5 py-2.5 flex items-center justify-between text-xs">
          <span className="text-slate-400">{t.currentBalance}</span>
          <span className="font-mono-tabular text-base font-bold text-[#A3E635]">
            {formatEgp(walletEgp)} {currency}
          </span>
        </div>

        {receipt ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-[#A3E635]/40 bg-[#A3E635]/10 p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#A3E635] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-100">
                  {t.xpayConfirmed}
                </div>
                <p className="text-xs text-slate-300">{receipt}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-lg bg-[#A3E635] hover:bg-[#BEF264] text-[#0B0F17] font-display font-bold text-sm transition-colors cursor-pointer"
            >
              {t.done}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="xpay-amount-input"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                {t.amountLabel}
              </label>
              <input
                id="xpay-amount-input"
                type="number"
                step="any"
                min={0.01}
                max={mode === 'cashout' ? Math.max(0.01, walletEgp) : 10000}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="w-full bg-[#0B0F17] border border-[#2A374E] focus:border-[#38BDF8] focus:outline-none rounded-lg px-3.5 py-2 font-mono-tabular text-base font-bold text-slate-100"
              />
              {mode === 'cashin' && (
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {CASH_IN_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmountInput(String(preset))}
                      className="py-1.5 rounded-md bg-[#0B0F17] border border-[#243044] hover:border-[#38BDF8] font-mono-tabular text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
                    >
                      +{preset}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="xpay-method-select"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                {t.channelLabel}
              </label>
              <select
                id="xpay-method-select"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full bg-[#0B0F17] border border-[#2A374E] focus:border-[#38BDF8] focus:outline-none rounded-lg px-3 py-2 text-sm text-slate-100"
              >
                <option value="Vodafone Cash / Wallet">{t.channelVodafone}</option>
                <option value="InstaPay Egypt">{t.channelInstaPay}</option>
                <option value="Meeza / Bank Card">{t.channelMeeza}</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="xpay-ref-input"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                {mode === 'cashin' ? t.refLabelCashIn : t.refLabelCashOut}
              </label>
              <input
                id="xpay-ref-input"
                type="text"
                maxLength={32}
                value={accountRef}
                onChange={(e) => setAccountRef(e.target.value)}
                className="w-full bg-[#0B0F17] border border-[#2A374E] focus:border-[#38BDF8] focus:outline-none rounded-lg px-3.5 py-2 text-sm text-slate-100"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-[#F43F5E]/40 bg-[#F43F5E]/10 px-3 py-2 text-xs text-[#FDA4AF]"
              >
                {error}
              </div>
            )}

            <p className="text-[11px] text-slate-400">
              {t.previewDisclaimer}
            </p>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="submit"
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#38BDF8] hover:bg-[#7DD3FC] text-[#0B0F17] font-display font-bold text-sm transition-colors cursor-pointer"
              >
                {mode === 'cashin' ? (
                  <>
                    <ArrowDownLeft className="w-4 h-4" aria-hidden="true" />
                    {t.confirmCashIn}
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                    {t.confirmCashOut}
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
