import type { AccountSubscription } from "@/lib/app-config";
import "next-auth";

declare module "next-auth" {
  interface Session {
    subscription?: AccountSubscription;
  }
}
