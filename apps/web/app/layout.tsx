import type { Metadata } from 'next';
import './globals.css';
import './design.css';

export const metadata: Metadata = {
  title: 'Canary',
  description: 'Vaults, canary monitoring and post-quantum recovery on QoreChain testnet.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
