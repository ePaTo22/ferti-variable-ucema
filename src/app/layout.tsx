import type { Metadata } from 'next';
import 'ol/ol.css';
import './globals.css';
export const metadata: Metadata = { title: 'Ferti | Prescripción variable', description: 'Demo de fertilización variable por ambiente' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
