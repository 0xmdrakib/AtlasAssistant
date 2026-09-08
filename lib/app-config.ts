export type PublicAppConfig = {
  price: { amount: string; currency: string };
  summaryEnabled: boolean;
};

export type AccountSubscription = {
  plan: "free" | "paid";
  status: string;
  isOwner: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
};
