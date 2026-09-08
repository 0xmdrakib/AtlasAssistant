"use client";

import * as React from "react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from "@/components/language-provider";
import { SavedItemsProvider } from "@/components/saved-provider";
import { AppConfigProvider } from "@/components/app-config-provider";
import type { PublicAppConfig } from "@/lib/app-config";

export function Providers({ children, config }: { children: React.ReactNode; config: PublicAppConfig }) {
  return (
    <SessionProvider refetchInterval={60}>
      <AppConfigProvider value={config}>
      <ThemeProvider>
        <LanguageProvider><SavedItemsProvider>{children}</SavedItemsProvider></LanguageProvider>
      </ThemeProvider>
      </AppConfigProvider>
    </SessionProvider>
  );
}
