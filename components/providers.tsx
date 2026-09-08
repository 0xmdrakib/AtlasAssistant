"use client";

import * as React from "react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from "@/components/language-provider";
import { SavedItemsProvider } from "@/components/saved-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <LanguageProvider><SavedItemsProvider>{children}</SavedItemsProvider></LanguageProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
