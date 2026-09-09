export type PaymentCurrency = { code: string; asset: string; network: string; label: string; minimum?: number };
export type PaymentMinimum = { code: string; minimum: number; currency: string; settlementCurrency?: string };
export type PaymentRateMode = "fixed-user" | "fixed-merchant" | "floating-merchant";

export type EmbeddedPayment = {
  id: string;
  status: string;
  amount: string;
  currency: string;
  discountCode: string | null;
  payCurrency: string | null;
  payAmount: string | null;
  payAddress: string | null;
  network: string | null;
  payinExtraId: string | null;
  expiresAt: string | null;
  activatedAt: string | null;
  hasReceivedFunds?: boolean;
  createdAt: string;
};

export const TERMINAL_PAYMENT_STATUSES = new Set(["finished", "failed", "refunded", "expired"]);

// Quote expiry is not a payment failure: retain records and all received transfers.
export function isExpiredUnpaidQuote(payment: EmbeddedPayment, now = Date.now()) {
  return !payment.activatedAt && !payment.hasReceivedFunds &&
    (payment.status === "expired" || payment.status === "waiting" && Boolean(payment.expiresAt && Date.parse(payment.expiresAt) <= now));
}

export class PaymentError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
