import { Nav } from "../components/Nav";
import { Hero } from "../components/Hero";
import { Story } from "../components/Story";
import { Bento } from "../components/Bento";
import { SelfHost } from "../components/SelfHost";
import { ClosingCta, Footer } from "../components/ClosingCta";

export default function LandingPage() {
  return (
    <div className="landing">
      <Nav />
      <Hero />
      <main>
        <Story />
        <Bento />
        <SelfHost />
        <ClosingCta />
      </main>
      <Footer />
    </div>
  );
}
