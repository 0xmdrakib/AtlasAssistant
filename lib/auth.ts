import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { planForSubscription, type SubscriptionUser } from "@/lib/billing";
import { markSessionUnavailable } from "@/lib/session-health";

const adapter = PrismaAdapter(prisma);

/**
 * NextAuth (v4) config.
 * We keep the rest of the app public, but AI routes check for a valid session.
 */
export const authOptions: NextAuthOptions = {
  adapter: {
    ...adapter,
    async getSessionAndUser(token) {
      try { return await adapter.getSessionAndUser!(token); }
      catch (error) { markSessionUnavailable(); throw error; }
    },
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],
  session: { strategy: "database" },
  callbacks: {
    async session({ session, user }) {
      // Expose user.id to the client (handy for quotas later)
      if (session.user) (session.user as any).id = user.id;
      // The database adapter already loads the complete user with the session.
      // Derive the display plan here instead of fetching billing again in each menu.
      const plan = planForSubscription(user as typeof user & SubscriptionUser);
      session.subscription = {
        ...plan,
        currentPeriodStart: plan.currentPeriodStart?.toISOString() || null,
        currentPeriodEnd: plan.currentPeriodEnd?.toISOString() || null,
      };
      return session;
    },
  },
};
