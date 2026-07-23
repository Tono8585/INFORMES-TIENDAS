import './globals.css';

export const metadata = {
  title: 'Informe Stock Tiendas',
  description: 'Distribución, cobertura y disponibilidad de modelos WOMAN-T3',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
