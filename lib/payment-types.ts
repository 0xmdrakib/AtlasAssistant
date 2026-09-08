export type PaymentCurrency = { code: string; asset: string; network: string; label: string };

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
  createdAt: string;
};

export const TERMINAL_PAYMENT_STATUSES = new Set(["finished", "failed", "refunded", "expired"]);

export class PaymentError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
