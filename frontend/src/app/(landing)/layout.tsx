import "./landing.css";

/** Public landing page: own sticky navbar, no app chrome; follows the light/dark theme. */
export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="landing">{children}</div>;
}
