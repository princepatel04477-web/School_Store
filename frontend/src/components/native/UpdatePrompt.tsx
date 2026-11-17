import { openExternalUrl } from '../../native/externalLinks';
import './updatePrompt.css';

interface UpdatePromptProps {
  updateUrl: string;
  latestVersion: string;
}

export function UpdatePrompt({ updateUrl, latestVersion }: UpdatePromptProps) {
  const handleUpdate = () => {
    if (updateUrl) {
      openExternalUrl(updateUrl);
    }
  };

  return (
    <div className="update-prompt-overlay" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="update-prompt-card">
        <div className="update-icon-badge">
          <svg viewBox="0 0 24 24" width="36" height="36" stroke="currentColor" fill="none" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
        <h2 id="update-title">Update Required</h2>
        <p>
          A new version of School Store ({latestVersion}) is required to continue browsing uniforms,
          sizing, and tracking orders securely.
        </p>
        <button type="button" className="native-primary-btn" onClick={handleUpdate}>
          Update on Google Play
        </button>
      </div>
    </div>
  );
}
