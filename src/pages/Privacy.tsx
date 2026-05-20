export default function Privacy() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Last updated: 20 May 2026
        </p>

        <section className="space-y-6 text-sm leading-relaxed">
          <p>
            Vanto CRM ("we", "us", "the platform") is operated by Online Course For MLM (Get Well Africa).
            This Privacy Policy explains how we collect, use, and protect personal data when you use the
            Vanto CRM web application, Chrome Extension, and connected WhatsApp / Facebook integrations.
          </p>

          <div>
            <h2 className="text-lg font-semibold mb-2">1. Data We Collect</h2>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>Account data: name, email, role (Agent / Admin / Super Admin).</li>
              <li>Contact data you save: name, phone number (E.164), WhatsApp ID, lead type, notes, tags.</li>
              <li>Conversation data: WhatsApp messages sent and received via Twilio / Maytapi integrations.</li>
              <li>Facebook content: Page posts ingested by the Facebook → WhatsApp automation module.</li>
              <li>System data: audit logs, integration health, AI suggestions, and dispatch results.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">2. How We Use Data</h2>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>To deliver CRM functionality: lead management, conversations, campaigns, automations.</li>
              <li>To generate AI-assisted message variants for WhatsApp Groups and Status broadcasts.</li>
              <li>To synchronise approved records with the connected Zazi CRM (one-way push).</li>
              <li>To monitor integration health and prevent abuse, spam, or policy violations.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">3. Third-Party Services</h2>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>Lovable Cloud (database, authentication, edge functions, storage).</li>
              <li>Twilio and Maytapi (WhatsApp messaging providers).</li>
              <li>Meta / Facebook Graph API (Page post ingestion).</li>
              <li>Lovable AI Gateway (Google Gemini, OpenAI GPT for copy generation).</li>
            </ul>
            <p className="mt-2 text-muted-foreground">
              We do not sell personal data. Data is only shared with the providers strictly required to
              operate the platform.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">4. Facebook Page Integration</h2>
            <p className="text-muted-foreground">
              When a Facebook Page is connected, we receive public post content (message, permalink,
              attachments, posted-at timestamp) via webhook or scheduled polling. We do not collect
              private messages, friend lists, or profile data of Page visitors. Page access tokens are
              stored encrypted and used only to fetch posts you have explicitly published.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">5. WhatsApp Messaging</h2>
            <p className="text-muted-foreground">
              Outbound messages are sent through licensed providers (Twilio / Maytapi) using your own
              business number. We retain message metadata (delivery status, provider message IDs) for
              audit and troubleshooting. We respect WhatsApp's 24-hour customer-care window and never
              use unauthorised browser automation to send messages.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">6. Security</h2>
            <p className="text-muted-foreground">
              All data is protected by Row-Level Security policies, role-based access control, and
              encrypted transport. Secrets and API tokens are stored in a managed secret vault and are
              never exposed to the browser.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">7. Data Retention &amp; Deletion</h2>
            <p className="text-muted-foreground">
              Contacts, conversations, and AI logs are retained for the lifetime of your account. You
              may request deletion of your account or specific contacts at any time by contacting
              support. Soft-deleted records are purged from active queries immediately and from
              backups within 30 days.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">8. Your Rights</h2>
            <p className="text-muted-foreground">
              Under POPIA (South Africa) and GDPR (where applicable), you have the right to access,
              correct, export, or delete your personal data. Submit requests to the contact address
              below.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">9. Contact</h2>
            <p className="text-muted-foreground">
              Online Course For MLM / Get Well Africa<br />
              Email: <a className="text-primary underline" href="mailto:support@onlinecourseformlm.com">support@onlinecourseformlm.com</a><br />
              Web: <a className="text-primary underline" href="https://onlinecourseformlm.com">onlinecourseformlm.com</a>
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">10. Changes</h2>
            <p className="text-muted-foreground">
              We may update this policy from time to time. Material changes will be communicated
              in-app or by email. Continued use of the platform constitutes acceptance.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
