"use client";

import * as React from "react";
import type { PublicAppConfig } from "@/lib/app-config";

const AppConfigContext = React.createContext<PublicAppConfig | null>(null);

export function AppConfigProvider({ value, children }: { value: PublicAppConfig; children: React.ReactNode }) {
  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig() {
  const config = React.useContext(AppConfigContext);
  if (!config) throw new Error("Missing app configuration");
  return config;
}
