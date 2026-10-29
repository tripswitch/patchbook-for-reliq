import { syncAvailable } from "../lib/sync";
import { ISSUES_URL, REPO_URL } from "../lib/links";

/** Plain-language privacy notice: what's stored where, and how to remove it. */
export function PrivacyPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="stack prose">
      <div className="ed-head">
        <div>
          <div className="sect">About</div>
          <h3>Privacy</h3>
        </div>
      </div>
      <p>
        <strong>On your device.</strong> Your patches, racks and module edits are stored in this browser on this device. Nothing is sent
        anywhere unless you turn on sync. There are no accounts, no analytics and no tracking.
      </p>
      {syncAvailable && (
        <>
          <p>
            <strong>If you turn on sync.</strong> Each change is encrypted on your device before it's uploaded, with a key made from your
            private sync key. The sync key itself never leaves your devices. The server (a Supabase database in London) stores only
            scrambled data, an opaque id for each item, and when it changed. Nobody else can read your patches, including whoever runs the
            server.
          </p>
          <p>
            <strong>How long it's kept.</strong> Until you delete it. <em>Backup &amp; sync → Delete my synced data</em> removes your sync
            space from the server straight away. Sync spaces nobody has used for 12 months are deleted automatically.
          </p>
        </>
      )}
      <p>
        <strong>Share links</strong> carry the patch inside the link itself, in the part after <span className="mono">#</span>, which
        browsers never send to a server. Anyone you give a share link to can read that patch.
      </p>
      <p>
        <strong>Hosting.</strong> The app is served by Vercel{syncAvailable ? " and sync runs on Supabase" : ""}. Like any web host, they
        keep short-lived technical logs (such as IP addresses) to run and protect their services. Patchbook itself doesn't collect or see
        them.
      </p>
      <p>
        Questions or problems: <a href={ISSUES_URL} target="_blank" rel="noreferrer">open an issue on GitHub</a>. The code is open:{" "}
        <a href={REPO_URL} target="_blank" rel="noreferrer">github.com/tripswitch/patchbook-for-reliq</a>.
      </p>
      <div className="ed-actions">
        <span />
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
