import "./styles.css";

export const metadata = {
  title: "PrepMaxxing · Career readiness, with a little sparkle",
  description: "A friendly placement-readiness studio for finding your next role and preparing for interviews.",
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
