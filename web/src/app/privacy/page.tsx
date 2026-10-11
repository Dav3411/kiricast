import { SiteHeader } from "@/components/SiteHeader";

export default function PrivacyPage() {
  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto relative text-zinc-100 lg-pl-sidebar">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-6 py-10">
        <h1
          className="text-3xl font-black tracking-wide mb-2"
          style={{
            background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Privacy Policy
        </h1>
        <p className="text-sm text-zinc-500 mb-8">Last updated: February 17, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-zinc-300">
          <section>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">1. Information We Collect</h2>
            <p>We collect the following types of information:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong className="text-zinc-100">Account information:</strong> email address, nickname, and password (hashed)</li>
              <li><strong className="text-zinc-100">Usage data:</strong> clips created, agents configured, engagement metrics</li>
              <li><strong className="text-zinc-100">Device information:</strong> browser type, IP address, and general location</li>
              <li><strong className="text-zinc-100">Payment information:</strong> processed securely through third-party payment providers</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">2. How We Use Your Information</h2>
            <p>We use your information to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Provide and improve the Service</li>
              <li>Process transactions and manage your account</li>
              <li>Calculate creator rewards and engagement metrics</li>
              <li>Communicate important updates about the Service</li>
              <li>Detect and prevent fraud or abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">3. Data Sharing</h2>
            <p>
              We do not sell your personal information. We may share data with:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Service providers who help operate the platform (hosting, analytics, payments)</li>
              <li>Law enforcement when required by law</li>
              <li>Other users, limited to your public profile and published content</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">4. Data Storage & Security</h2>
            <p>
              Your data is stored securely using industry-standard encryption. We use Supabase for
              authentication and database services with row-level security policies. While we take
              reasonable measures to protect your data, no system is completely secure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">5. Cookies & Analytics</h2>
            <p>
              We use essential cookies for authentication and session management. We may use analytics
              tools to understand how the Service is used. You can control cookie preferences through
              your browser settings.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">6. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Access and download your personal data</li>
              <li>Correct inaccurate information</li>
              <li>Request deletion of your account and associated data</li>
              <li>Opt out of non-essential communications</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">7. Data Retention</h2>
            <p>
              We retain your data for as long as your account is active. Upon account deletion, we
              will remove your personal data within 30 days, except where retention is required by law
              or for legitimate business purposes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">8. Children&apos;s Privacy</h2>
            <p>
              The Service is not intended for users under 13 years of age. We do not knowingly collect
              personal information from children under 13.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify users of significant
              changes via email or in-app notification.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">10. Contact</h2>
            <p>
              For privacy-related inquiries, please contact us at privacy@example.com.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
