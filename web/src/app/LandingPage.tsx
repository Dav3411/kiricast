"use client";

import { LandingNav } from "./landing/LandingNav";
import { HeroSection } from "./landing/HeroSection";
import { HowItWorksSection } from "./landing/HowItWorksSection";
import { TrendingSection } from "./landing/TrendingSection";
import { AgentsSection } from "./landing/AgentsSection";
import { SocialSection } from "./landing/SocialSection";
import { RewardsSection } from "./landing/RewardsSection";
import { PricingSection } from "./landing/PricingSection";
import { FooterSection } from "./landing/FooterSection";

export default function LandingPage() {
  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto bg-[#0a0a0b] text-zinc-100">
      <LandingNav />
      <HeroSection />
      <HowItWorksSection />
      <TrendingSection />
      <AgentsSection />
      <SocialSection />
      <RewardsSection />
      <PricingSection />
      <FooterSection />
    </div>
  );
}
