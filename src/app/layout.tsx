import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbit — Project Management Tool",
  description: "Plan projects, manage tasks, collaborate with teams, and track deadlines with Orbit.",
  openGraph: {
    title: "Orbit — Project Management Tool",
    description: "Plan projects, manage tasks, collaborate with teams, and track deadlines with Orbit.",
    siteName: "Orbit",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
