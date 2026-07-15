import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Insurance Autopilot — Operations",
  description: "Operations console for the Insurance Autopilot workflow platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
