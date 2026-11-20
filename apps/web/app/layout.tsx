import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Canary · Post-quantum safety',
  description: 'QoreChain testnet discovery console. No vaults deployed yet.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
