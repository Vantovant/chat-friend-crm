export default function Terms() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: 15 August 2026</p>

        <section className="space-y-6 text-sm leading-relaxed">
          <p>
            These Terms of Service ("Terms") govern your use of GetWell Hub, the Vanto CRM web
            application, Chrome Extension, and connected WhatsApp / Facebook integrations
            (together, "the Platform"), operated by Get Well Africa ("we", "us"). By logging into
            or using the Platform, you agree to these Terms.
          </p>

          <div>
            <h2 className="text-lg font-semibold mb-2">1. Who Can Use the Platform</h2>
            <p className="text-muted-foreground">
              The Platform is provided for use by authorised staff, agents, and administrators of
              Get Well Africa and its distributor network. Access is granted per-account by an
              Admin or Super Admin and may be revoked at any time.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">2. What the Platform Does</h2>
            <p className="text-muted-foreground">
              The Platform is a CRM that lets authorised users manage contacts, send and receive
              WhatsApp messages (via Twilio and Maytapi), read and reply to Facebook Page comments
              and Messenger conversations, run approved WhatsApp group campaigns, and use
              AI-assisted tools to draft message copy. See our{" "}
              <a className="text-primary underline" href="/privacy">Privacy Policy</a> for details
              on what data this involves.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">3. Acceptable Use</h2>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>You will only message people who have opted in or genuinely engaged with our Page, ads, or WhatsApp number.</li>
              <li>You will not use the Platform to send spam, unsolicited bulk messages, or content that violates WhatsApp's or Meta's platform policies.</li>
              <li>You will not attempt to circumvent rate limits, safety validators, or messaging-window restrictions built into the Platform.</li>
              <li>You will not use the Platform to collect or process data on individuals beyond what is necessary for legitimate customer service and sales follow-up.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">4. Facebook &amp; Meta Platform Compliance</h2>
            <p className="text-muted-foreground">
              Features that read or reply to Facebook Page comments and Messenger messages are
              subject to Meta's Platform Policies and Developer Terms, in addition to these Terms.
              We only use Page and Messenger data to provide customer service in direct response to
              genuine customer contact, never for advertising or resale.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">5. Account Responsibility</h2>
            <p className="text-muted-foreground">
              You are responsible for keeping your login credentials confidential and for all
              activity under your account. Notify us immediately if you suspect unauthorised access.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">6. Availability &amp; Changes</h2>
            <p className="text-muted-foreground">
              We aim to keep the Platform available but do not guarantee uninterrupted service.
              Features may change, be added, or be removed as the Platform evolves. We'll do our
              best to communicate material changes affecting how you use the Platform.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">7. Limitation of Liability</h2>
            <p className="text-muted-foreground">
              The Platform is provided "as is." To the extent permitted by law, we are not liable
              for indirect, incidental, or consequential damages arising from use of the Platform,
              including message delivery failures caused by third-party providers (Twilio, Maytapi,
              Meta) outside our control.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">8. Governing Law</h2>
            <p className="text-muted-foreground">
              These Terms are governed by the laws of South Africa, without regard to conflict of
              law principles.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">9. Contact</h2>
            <p className="text-muted-foreground">
              GetWell Hub / Get Well Africa<br />
              Email: <a className="text-primary underline" href="mailto:support@getwellhub.dev">support@getwellhub.dev</a><br />
              Web: <a className="text-primary underline" href="https://getwellhub.dev">getwellhub.dev</a>
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">10. Changes to These Terms</h2>
            <p className="text-muted-foreground">
              We may update these Terms from time to time. Material changes will be communicated
              in-app or by email. Continued use of the Platform constitutes acceptance of the
              updated Terms.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
