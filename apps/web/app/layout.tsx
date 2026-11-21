import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Canary · Post-quantum safety',
  description: 'An early warning. A way out. Canary’s post-quantum vault protection and migration workspace on QoreChain testnet.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
