import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PaymentSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addOneMonth, planForSubscription } from "@/lib/billing";
import { discountPrice } from "@/lib/discounts";
import { subscriptionPrice } from "@/lib/paymentProviders";
import { assertPaymentMinimum, canonicalJson, createNowpaymentsPayment, getPaymentCurrencies, getPaymentMinimum, nowpaymentsRequest, paymentExpiry, type ProviderPayment } from "@/lib/nowpayments";
import { PaymentError, TERMINAL_PAYMENT_STATUSES, type EmbeddedPayment } from "@/lib/payment-types";

type Tx = Prisma.TransactionClient;
const PROGRESS: Record<string, number> = { creating: 0, pending: 0, waiting: 1, confirming: 2, confirmed: 3, sending: 4, partially_paid: 4, finished: 5 };
const PROVIDER_STATUSES = new Set(["waiting", "confirming", "confirmed", "sending", "partially_paid", "finished", "failed", "expired", "refunded"]);

export function paymentDto(row: PaymentSession): EmbeddedPayment {
  return {
    id: row.id, status: row.status, amount: row.finalPriceAmount || row.priceAmount, currency: row.priceCurrency,
    discountCode: row.discountCode, payCurrency: row.payCurrency, payAmount: row.payAmount, payAddress: row.payAddress,
    network: row.network, payinExtraId: row.payinExtraId,
    expiresAt: row.paymentExpiresAt?.toISOString() || null, activatedAt: row.activatedAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
  };
}

function positive(value: unknown): number | null {
  const result = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(result) && result > 0 ? result : null;
}

export function validatePaymentDetails(row: Pick<PaymentSession, "orderId" | "nowpaymentsPaymentId" | "priceCurrency" | "priceAmount" | "finalPriceAmount" | "payCurrency" | "payAmount" | "payAddress">, payload: ProviderPayment, finished: boolean) {
  const fail = (message: string) => { throw new PaymentError("PAYMENT_MISMATCH", message, 409); };
  if (!payload.payment_id || String(payload.order_id) !== row.orderId) fail("Payment does not match this order.");
  if (row.nowpaymentsPaymentId && String(payload.payment_id) !== row.nowpaymentsPaymentId) fail("Payment ID does not match this order.");
  const amount = positive(payload.price_amount);
  if (!amount || Math.abs(amount - Number(row.finalPriceAmount || row.priceAmount)) > 0.000001 || String(payload.price_currency).toLowerCase() !== row.priceCurrency.toLowerCase()) fail("Payment price does not match this order.");
  if (row.payCurrency && String(payload.pay_currency).toLowerCase() !== row.payCurrency) fail("Payment network does not match this order.");
  if (row.payAddress && payload.pay_address && String(payload.pay_address) !== row.payAddress) fail("Payment address does not match this order.");
  if (finished) {
    const expected = positive(row.payAmount || payload.pay_amount);
    const received = positive(payload.actually_paid);
    if (!expected || !received || received + Math.max(expected * 1e-8, 1e-12) < expected) {
      throw new PaymentError("PAYMENT_UNDERPAID", "The full payment has not been received. Contact billing support with your payment ID.", 409);
    }
  }
}

async function lockUser(tx: Tx, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user) throw new PaymentError("UNAUTHORIZED", "Please sign in again.", 401);
  return user;
}

async function reserveDiscount(tx: Tx, userId: string, code: string, paymentId: string, amount: string, currency: string, free: boolean) {
  await tx.$queryRaw`SELECT "id" FROM "DiscountCode" WHERE "code" = ${code} FOR UPDATE`;
  const discount = await tx.discountCode.findUnique({ where: { code } });
  if (!discount?.active || (discount.expiresAt && discount.expiresAt <= new Date())) throw new PaymentError("INVALID_DISCOUNT", "This discount code is unavailable or expired.");
  if (discount.maxRedemptions !== null && discount.redeemedCount >= discount.maxRedemptions) throw new PaymentError("INVALID_DISCOUNT", "This discount code has reached its claim limit.");
  if ((discount.percentOff === 100) !== free) throw new PaymentError("DISCOUNT_TYPE", free ? "This code does not cover the full price." : "Use free activation for this discount code.");
  const existing = await tx.discountRedemption.findUnique({ where: { discountCodeId_userId: { discountCodeId: discount.id, userId } } });
  if (existing) throw new PaymentError("DISCOUNT_CLAIMED", "You already claimed this code. Resume the existing checkout if payment is still pending.");
  await tx.discountRedemption.create({ data: { discountCodeId: discount.id, userId, paymentSessionId: paymentId, percentOff: discount.percentOff, status: "pending" } });
  await tx.discountCode.update({ where: { id: discount.id }, data: { redeemedCount: { increment: 1 } } });
  return discountPrice(amount, currency, discount.percentOff);
}

async function releaseDiscount(tx: Tx, paymentId: string) {
  const redemption = await tx.discountRedemption.findFirst({ where: { paymentSessionId: paymentId, status: "pending" } });
  if (!redemption) return;
  await tx.$queryRaw`SELECT "id" FROM "DiscountCode" WHERE "id" = ${redemption.discountCodeId} FOR UPDATE`;
  const removed = await tx.discountRedemption.deleteMany({ where: { id: redemption.id, status: "pending" } });
  if (removed.count) await tx.discountCode.update({ where: { id: redemption.discountCodeId }, data: { redeemedCount: { decrement: 1 } } });
}

async function grantAccess(tx: Tx, row: PaymentSession) {
  if (row.activatedAt) return;
  const user = await lockUser(tx, row.userId);
  const now = new Date();
  const current = planForSubscription(user, now);
  // A late second settlement must add paid time, never shorten an existing period.
  await tx.user.update({ where: { id: row.userId }, data: {
    subscriptionPlan: "paid", subscriptionStatus: "active", subscriptionProvider: row.method === "discount" ? "discount" : "nowpayments",
    subscriptionCurrentPeriodStart: current.plan === "paid" ? current.currentPeriodStart || now : now,
    subscriptionCurrentPeriodEnd: addOneMonth(current.currentPeriodEnd || now),
  } });
  await tx.paymentSession.update({ where: { id: row.id }, data: { activatedAt: now, status: "finished" } });
  await tx.discountRedemption.updateMany({ where: { paymentSessionId: row.id, status: "pending" }, data: { status: "redeemed", redeemedAt: now } });
}

export async function beginCheckout(args: { userId: string; requestId: string; payCurrency?: string; discountCode?: string; free?: boolean }) {
  const requestKey = `${args.userId}:${args.requestId}`;
  const previous = await prisma.paymentSession.findUnique({ where: { requestKey } });
  if (previous) return paymentDto(previous);
  const selected = !args.free ? (await getPaymentCurrencies()).find((currency) => currency.code === args.payCurrency) : null;
  if (!args.free && !selected) throw new PaymentError("INVALID_NETWORK", "Choose an available payment network.");
  const price = subscriptionPrice();
  if (!positive(price.amount) || !/^[a-z]{3}$/.test(price.currency)) throw new PaymentError("CHECKOUT_UNAVAILABLE", "Pricing is temporarily unavailable.", 503);
  const minimum = selected ? await getPaymentMinimum(selected.code) : null;
  if (minimum) assertPaymentMinimum(price.amount, minimum);
  const prepared = await prisma.$transaction(async (tx) => {
    const user = await lockUser(tx, args.userId);
    const repeated = await tx.paymentSession.findUnique({ where: { requestKey } });
    if (repeated) return { row: repeated, created: false };
    if (planForSubscription(user).plan === "paid") throw new PaymentError("ALREADY_ACTIVE", "Your Pro access is already active.", 409);
    const recent = await tx.paymentSession.count({ where: { userId: args.userId, createdAt: { gte: new Date(Date.now() - 600000) } } });
    if (recent >= 5) throw new PaymentError("CHECKOUT_LIMIT", "Please resume your recent checkout or try again in a few minutes.", 429);
    const code = String(args.discountCode || "").trim().toUpperCase();
    if (args.free && !code) throw new PaymentError("INVALID_DISCOUNT", "Enter a discount code.");
    const row = await tx.paymentSession.create({ data: {
      userId: args.userId, requestKey, orderId: `atlas_${randomUUID()}`, method: args.free ? "discount" : "crypto",
      status: "creating", priceAmount: price.amount, priceCurrency: price.currency,
      payCurrency: selected?.code || null, network: selected?.network || null, discountCode: code || null,
    } });
    const discount = code ? await reserveDiscount(tx, args.userId, code, row.id, price.amount, price.currency, Boolean(args.free)) : null;
    if (minimum) assertPaymentMinimum(discount?.finalAmount || price.amount, minimum);
    const updated = await tx.paymentSession.update({ where: { id: row.id }, data: { finalPriceAmount: discount?.finalAmount || price.amount, discountPercentOff: discount?.percentOff || null } });
    if (args.free) await grantAccess(tx, updated);
    return { row: args.free ? (await tx.paymentSession.findUniqueOrThrow({ where: { id: row.id } })) : updated, created: true };
  }, { timeout: 15000 });
  if (!prepared.created || args.free) return paymentDto(prepared.row);
  try {
    const row = prepared.row;
    const payload = await createNowpaymentsPayment({ orderId: row.orderId, amount: row.finalPriceAmount || row.priceAmount, currency: row.priceCurrency, payCurrency: row.payCurrency!, discountCode: row.discountCode });
    validatePaymentDetails(row, payload, false);
    if (!positive(payload.pay_amount) || typeof payload.pay_address !== "string" || !payload.pay_address.trim()) throw new PaymentError("INVALID_PAYMENT", "The payment service returned incomplete details. Please try again.", 502);
    return (await applyPaymentUpdate(payload)).payment;
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PaymentSession" WHERE "id" = ${prepared.row.id} FOR UPDATE`;
      const current = await tx.paymentSession.findUniqueOrThrow({ where: { id: prepared.row.id } });
      if (!current.activatedAt && ["creating", "pending", "waiting"].includes(current.status)) {
        await tx.paymentSession.update({ where: { id: current.id }, data: { status: "failed" } });
        await releaseDiscount(tx, current.id);
      }
    });
    throw error;
  }
}

// Only call with a verified IPN or a response fetched directly from NOWPayments.
// Status, event receipt, discount redemption and access grant commit atomically.
export async function applyPaymentUpdate(payload: ProviderPayment, recordEvent = false) {
  const orderId = String(payload.order_id || "");
  const paymentId = String(payload.payment_id || "");
  const status = String(payload.payment_status || "").toLowerCase();
  if (!paymentId || !PROVIDER_STATUSES.has(status)) throw new PaymentError("INVALID_PAYMENT", "Invalid payment update.");
  return prisma.$transaction(async (tx) => {
    const match = orderId ? await tx.paymentSession.findUnique({ where: { orderId } }) : await tx.paymentSession.findFirst({ where: { OR: [
      { nowpaymentsPaymentId: paymentId }, ...(payload.invoice_id ? [{ nowpaymentsInvoiceId: String(payload.invoice_id) }] : []),
    ] } });
    if (!match) throw new PaymentError("PAYMENT_NOT_FOUND", "Payment was not found.", 404);
    await tx.$queryRaw`SELECT "id" FROM "PaymentSession" WHERE "id" = ${match.id} FOR UPDATE`;
    const row = await tx.paymentSession.findUniqueOrThrow({ where: { id: match.id } });
    const verified = orderId ? payload : { ...payload, order_id: row.orderId };
    validatePaymentDetails(row, verified, status === "finished" && !row.activatedAt);
    if (recordEvent) {
      const eventId = `${paymentId}:${status}:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
      const event = await tx.paymentEvent.createMany({ data: [{ provider: "nowpayments", eventId, paymentId, orderId: row.orderId, status, raw: payload as Prisma.InputJsonValue }], skipDuplicates: true });
      if (!event.count) return { payment: paymentDto(row), duplicate: true };
    }
    let nextStatus = status;
    if (row.activatedAt && status !== "refunded") nextStatus = row.status === "refunded" ? "refunded" : "finished";
    else if ((TERMINAL_PAYMENT_STATUSES.has(row.status) && status !== "finished") || (PROGRESS[status] !== undefined && PROGRESS[row.status] > PROGRESS[status])) nextStatus = row.status;
    const updated = await tx.paymentSession.update({ where: { id: row.id }, data: {
      status: nextStatus, nowpaymentsPaymentId: paymentId,
      nowpaymentsPurchaseId: payload.purchase_id ? String(payload.purchase_id) : row.nowpaymentsPurchaseId,
      payCurrency: row.payCurrency || (payload.pay_currency ? String(payload.pay_currency).toLowerCase() : null),
      payAmount: row.payAmount || (positive(payload.pay_amount) ? String(payload.pay_amount) : null),
      payAddress: row.payAddress || (typeof payload.pay_address === "string" ? payload.pay_address : null),
      payinExtraId: row.payinExtraId ?? (payload.payin_extra_id != null ? String(payload.payin_extra_id) : null),
      network: row.network || (typeof payload.network === "string" ? payload.network : null),
      paymentExpiresAt: paymentExpiry(payload) || row.paymentExpiresAt,
      rawProviderData: payload as Prisma.InputJsonValue,
    } });
    if (status === "finished" && !row.activatedAt) await grantAccess(tx, updated);
    else if (["failed", "expired"].includes(nextStatus) && !row.activatedAt) await releaseDiscount(tx, row.id);
    return { payment: paymentDto(await tx.paymentSession.findUniqueOrThrow({ where: { id: row.id } })), duplicate: Boolean(row.activatedAt) };
  }, { timeout: 15000 });
}

export async function readPayment(userId: string, id: string, reconcile = true) {
  const row = await prisma.paymentSession.findFirst({ where: { id, userId } });
  if (!row) throw new PaymentError("PAYMENT_NOT_FOUND", "Payment was not found.", 404);
  if (!reconcile || row.activatedAt || (TERMINAL_PAYMENT_STATUSES.has(row.status) && row.status !== "finished") || !row.nowpaymentsPaymentId) return paymentDto(row);
  const claimed = await prisma.paymentSession.updateMany({ where: { id, userId, OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: new Date(Date.now() - 5000) } }] }, data: { lastPolledAt: new Date() } });
  if (!claimed.count) return paymentDto(row);
  const payload = await nowpaymentsRequest(`/payment/${encodeURIComponent(row.nowpaymentsPaymentId)}`);
  validatePaymentDetails(row, payload, false);
  return (await applyPaymentUpdate(payload)).payment;
}

export async function currentPayment(userId: string) {
  const row = await prisma.paymentSession.findFirst({ where: { userId, requestKey: { not: null }, status: { in: ["creating", "waiting", "confirming", "confirmed", "sending", "partially_paid"] }, createdAt: { gte: new Date(Date.now() - 86400000) } }, orderBy: { createdAt: "desc" } });
  return row ? paymentDto(row) : null;
}
