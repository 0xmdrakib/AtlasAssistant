"use client";

import * as React from "react";
import Image from "next/image";
import { Check, ChevronDown, Coins } from "lucide-react";
import type { PaymentCurrency } from "@/lib/payment-types";

export function TokenIcon({ asset }: { asset: string }) {
  if (asset !== "USDT" && asset !== "USDC") return <Coins size={28} aria-hidden="true" />;
  return <Image src={`/tokens/${asset.toLowerCase()}.svg`} width={28} height={28} alt={`${asset} logo`} className="shrink-0 rounded-full" unoptimized />;
}

export function PaymentNetworkPicker({ currencies, value, disabled, onChange, label, placeholder }: {
  currencies: PaymentCurrency[]; value: string; disabled: boolean; onChange: (value: string) => void; label: string; placeholder: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [focused, setFocused] = React.useState(0);
  const root = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const options = React.useRef<(HTMLButtonElement | null)[]>([]);
  const id = React.useId();
  const selected = currencies.find((currency) => currency.code === value);

  React.useEffect(() => {
    if (!open) return;
    options.current[focused]?.focus();
  }, [open, focused]);

  React.useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const expand = () => { setFocused(Math.max(0, currencies.findIndex((currency) => currency.code === value))); setOpen(true); };
  return <div ref={root} className="space-y-2" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`} disabled={disabled}
      onClick={() => open ? close() : expand()} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); expand(); } }}
      className="flex w-full items-center gap-3 rounded-xl border border-soft bg-solid-muted p-3 text-left text-sm focus-ring disabled:opacity-50">
      {selected ? <TokenIcon asset={selected.asset} /> : <span className="flex gap-1"><TokenIcon asset="USDC" /><TokenIcon asset="USDT" /></span>}
      <span className="min-w-0 flex-1">{selected ? <><span className="block font-semibold">{selected.asset}</span><span className="block text-xs text-muted">{selected.network}</span></> : placeholder}</span>
      <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open ? <div id={`${id}-options`} role="listbox" aria-label="Available payment networks" className="max-h-72 space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-soft bg-solid-surface p-1.5"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setFocused(event.key === "Home" ? 0 : event.key === "End" ? currencies.length - 1 : (focused + (event.key === "ArrowDown" ? 1 : -1) + currencies.length) % currencies.length);
        }
      }}>
      {currencies.map((currency, index) => <button ref={(element) => { options.current[index] = element; }} key={currency.code} type="button" role="option" aria-label={currency.label} aria-selected={value === currency.code} tabIndex={focused === index ? 0 : -1}
        onFocus={() => setFocused(index)} onClick={() => { onChange(currency.code); close(); }}
        className={`flex w-full items-center gap-3 rounded-lg p-3 text-left focus-ring hover:bg-subtle-2 ${value === currency.code ? "bg-subtle-2" : ""}`}>
        <TokenIcon asset={currency.asset} /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{currency.asset}</span><span className="block text-xs text-muted">{currency.network}</span></span>
        {value === currency.code ? <Check size={16} className="shrink-0 text-[hsl(var(--accent))]" aria-hidden="true" /> : null}
      </button>)}
    </div> : null}
  </div>;
}
