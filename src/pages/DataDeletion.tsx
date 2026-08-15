export default function DataDeletion() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Data Deletion Instructions</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: 15 August 2026</p>

        <section className="space-y-6 text-sm leading-relaxed">
          <p>
            If you'd like your personal data deleted from GetWell Hub / Vanto CRM (operated by Get
            Well Africa) — including data received through our Facebook Page comments, Messenger
            integration, or WhatsApp conversations — follow the steps below.
          </p>

          <div>
            <h2 className="text-lg font-semibold mb-2">How to Request Deletion</h2>
            <p className="text-muted-foreground">
              Email <a className="text-primary underline" href="mailto:support@getwellhub.dev">support@getwellhub.dev</a>{" "}
              with the subject line "Data Deletion Request." Please include enough information for
              us to locate your record — for example, the phone number, email address, or name you
              used to contact us, or the Facebook/Messenger account you messaged us from.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">What Gets Deleted</h2>
            <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
              <li>Your contact record (name, phone number, tags, notes).</li>
              <li>Conversation history across WhatsApp, Facebook comments, and Messenger.</li>
              <li>Any AI-generated suggestions or summaries tied to your record.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">Timeline</h2>
            <p className="text-muted-foreground">
              Your record is removed from active systems immediately upon confirmed request, and
              purged from backups within 30 days. This matches the retention terms in our{" "}
              <a className="text-primary underline" href="/privacy">Privacy Policy</a>.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">Facebook / Meta Data Specifically</h2>
            <p className="text-muted-foreground">
              If you contacted us via a Facebook Page comment or Messenger, deleting your original
              comment or message on Facebook does not automatically delete the copy we stored for
              customer-service purposes — please also submit a request here to ensure it's removed
              from our systems.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">Contact</h2>
            <p className="text-muted-foreground">
              GetWell Hub / Get Well Africa<br />
              Email: <a className="text-primary underline" href="mailto:support@getwellhub.dev">support@getwellhub.dev</a>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
