import "./landing.css";

/** Public landing page: always dark, its own sticky navbar, no app chrome. */
export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="landing">{children}</div>;
}
