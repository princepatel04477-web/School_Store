import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, deleteChildPhotos } from '../../api';
import { useAuth } from '../../auth';
import { useLang, LANGUAGES } from '../../i18n';
import { User, ShieldCheck, SignOut, ChevronRight, RefreshCw, Bell } from '../../components/ui/icons';
import { ParentSignInSheet } from '../../components/parent/ParentSignInSheet';
import { isBiometricsEnabled, enableBiometrics, clearBiometrics } from '../../native/biometrics';
import { checkAppVersion, INSTALLED_APP_VERSION, type VersionCheckResult } from '../../native/appVersion';
import { openExternalUrl } from '../../native/externalLinks';
import { haptic } from '../../native/haptics';
import { updateOrderNotificationPreference } from '../../native/push';
import './nativePages.css';

interface UserWithNotifications {
  notify_order_updates?: boolean;
}

interface StudentRecord {
  id: string;
  name?: string;
  school_name?: string;
  grade_name?: string;
  class_name?: string;
  gr_number?: string;
}

export function ProfileTab() {
  const { user, signOut } = useAuth();
  const { lang, setLang } = useLang();
  const navigate = useNavigate();
  const [showSignIn, setShowSignIn] = useState(false);
  const [photoDeleteStatus, setPhotoDeleteStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [biometricsActive, setBiometricsActive] = useState(false);
  const [versionChecking, setVersionChecking] = useState(false);
  const [versionResult, setVersionResult] = useState<VersionCheckResult | null>(null);
  const [orderUpdatesActive, setOrderUpdatesActive] = useState<boolean>(
    Boolean((user as unknown as UserWithNotifications)?.notify_order_updates ?? true)
  );

  useEffect(() => {
    if (user && 'notify_order_updates' in user) {
      setOrderUpdatesActive(Boolean((user as unknown as UserWithNotifications).notify_order_updates));
    }
  }, [user]);

  const handleToggleOrderUpdates = async () => {
    haptic.impactLight();
    const nextVal = !orderUpdatesActive;
    setOrderUpdatesActive(nextVal);
    const success = await updateOrderNotificationPreference(nextVal);
    if (success) {
      haptic.success();
    } else {
      setOrderUpdatesActive(!nextVal);
      haptic.warning();
    }
  };

  useEffect(() => {
    isBiometricsEnabled().then((enabled) => setBiometricsActive(enabled));
  }, []);

  const handleToggleBiometrics = async () => {
    haptic.impactLight();
    if (biometricsActive) {
      await clearBiometrics();
      setBiometricsActive(false);
    } else {
      // In real session, enable with existing refresh token
      await enableBiometrics('biometric_enabled');
      setBiometricsActive(true);
      haptic.success();
    }
  };

  const handleCheckUpdate = async () => {
    haptic.impactLight();
    setVersionChecking(true);
    try {
      const res = await checkAppVersion();
      setVersionResult(res);
      if (res.isOutdated) {
        haptic.warning();
      } else {
        haptic.success();
      }
    } finally {
      setVersionChecking(false);
    }
  };

  const { data: studentsData } = useQuery({
    queryKey: ['profile-students', user?.id],
    queryFn: () => api<{ results: StudentRecord[] }>('/students/').catch(() => null),
    enabled: Boolean(user && user.role === 'PARENT'),
  });

  const students = studentsData?.results || [];

  const handleDeletePhotos = async () => {
    if (!window.confirm('Delete all stored fitting photos and measurements under your DPDP rights?')) return;
    setPhotoDeleteStatus('working');
    try {
      if (students.length > 0) {
        for (const s of students) {
          if (s.id) await deleteChildPhotos(s.id);
        }
      } else {
        await deleteChildPhotos('me');
      }
      setPhotoDeleteStatus('done');
    } catch {
      setPhotoDeleteStatus('error');
    }
  };

  return (
    <div className="native-page-container">
      <div className="native-section-header">
        <div>
          <span className="native-eyebrow">ACCOUNT</span>
          <h1>My Profile</h1>
        </div>
      </div>

      {user ? (
        <div className="native-card profile-user-card">
          <div className="native-profile-avatar">
            {user.username.slice(0, 1).toUpperCase()}
          </div>
          <div className="native-profile-info">
            <h3>{[user.first_name, user.last_name].filter(Boolean).join(' ') || user.phone || user.username}</h3>
            {user.phone && <div className="native-child-meta">+91 {user.phone.slice(-10)}</div>}
            {!user.username.startsWith('parent_') && (
              <div className="native-child-meta">User ID: {user.username}</div>
            )}
            <span className="native-role-tag">{user.role}</span>
          </div>
        </div>
      ) : (
        <div className="native-card guest-card">
          <div className="guest-info">
            <h3>Sign in to School Store</h3>
            <p>Access your child’s uniform lists, save sizing, and track shipments.</p>
          </div>
          <div className="guest-actions">
            <button
              type="button"
              className="native-primary-btn"
              onClick={() => setShowSignIn(true)}
            >
              Sign in or create account
            </button>
            <Link to="/login" className="native-secondary-btn">
              Staff / Admin login
            </Link>
          </div>
        </div>
      )}

      {/* Children Section for Parents */}
      {user?.role === 'PARENT' && (
        <div className="native-card">
          <div className="native-card-title-row">
            <User width={20} height={20} />
            <h3>Registered Children</h3>
          </div>
          {students.length > 0 ? (
            <div className="native-children-list">
              {students.map((child: StudentRecord) => (
                <div className="native-child-row" key={child.id}>
                  <div>
                    <strong>{child.name}</strong>
                    <div className="native-child-meta">
                      {child.school_name || 'School'} · Standard {child.grade_name || child.class_name || '-'}
                    </div>
                  </div>
                  <span className="native-gr-badge">{child.gr_number || 'GR'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="native-hint">No student records linked to this account yet.</p>
          )}
        </div>
      )}

      {/* Biometric Unlock Option for Signed-In Users */}
      {user && (
        <div className="native-card">
          <div className="native-card-title-row">
            <ShieldCheck width={20} height={20} />
            <h3>Security & Fast Unlock</h3>
          </div>
          <p className="native-hint">
            Unlock your orders, saved sizes, and children profiles using fingerprint or face unlock.
          </p>
          <button
            type="button"
            className={`native-lang-chip ${biometricsActive ? 'active' : ''}`}
            onClick={handleToggleBiometrics}
          >
            {biometricsActive ? '✓ Fingerprint Unlock Enabled' : 'Enable Fingerprint Unlock Next Time'}
          </button>
        </div>
      )}

      {/* Push Notifications for Order Status Updates */}
      {user && (
        <div className="native-card">
          <div className="native-card-title-row">
            <Bell width={20} height={20} />
            <h3>Order Status Notifications</h3>
          </div>
          <p className="native-hint">
            Get instant phone updates when uniform orders are confirmed, dispatched, ready for pickup, or delivered.
          </p>
          <button
            type="button"
            className={`native-lang-chip ${orderUpdatesActive ? 'active' : ''}`}
            onClick={handleToggleOrderUpdates}
          >
            {orderUpdatesActive ? '✓ Order notifications enabled' : 'Turn on order notifications'}
          </button>
        </div>
      )}

      {/* Language Preferences */}
      <div className="native-card">
        <h3>Language / ભાષા / भाषा</h3>
        <div className="native-lang-selector">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              className={`native-lang-chip ${lang === l.code ? 'active' : ''}`}
              onClick={() => setLang(l.code)}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>

      {/* Privacy & DPDP Rights */}
      <div className="native-card">
        <div className="native-card-title-row">
          <ShieldCheck width={20} height={20} />
          <h3>Privacy & Data Control (DPDP)</h3>
        </div>
        <p className="native-hint">
          Under the Digital Personal Data Protection Act, you have the right to erase all measurement photos
          and sizing samples at any time.
        </p>
        <button
          type="button"
          className="native-danger-btn"
          disabled={photoDeleteStatus === 'working'}
          onClick={handleDeletePhotos}
        >
          {photoDeleteStatus === 'working'
            ? 'Deleting…'
            : photoDeleteStatus === 'done'
            ? 'Photos & Measurements Erased'
            : 'Erase Child Measurement Photos'}
        </button>
      </div>

      {/* Quick Navigation Links */}
      <div className="native-card menu-card">
        <Link to="/about" className="native-menu-item">
          <span>About School Store</span>
          <ChevronRight width={18} height={18} />
        </Link>
        <Link to="/privacy" className="native-menu-item">
          <span>Privacy Policy</span>
          <ChevronRight width={18} height={18} />
        </Link>
        <Link to="/terms" className="native-menu-item">
          <span>Terms of Service</span>
          <ChevronRight width={18} height={18} />
        </Link>
        <Link to="/refunds" className="native-menu-item">
          <span>Returns & Refunds</span>
          <ChevronRight width={18} height={18} />
        </Link>
      </div>

      {/* App Version & Update Check */}
      <div className="native-card version-card">
        <div className="version-info-row">
          <div>
            <strong>School Store Native App</strong>
            <div className="native-hint">Installed version: v{INSTALLED_APP_VERSION} (Build 1)</div>
          </div>
          <button
            type="button"
            className="native-secondary-btn"
            disabled={versionChecking}
            onClick={handleCheckUpdate}
          >
            {versionChecking ? 'Checking…' : 'Check for update'}
          </button>
        </div>

        {versionResult && (
          <div className={`version-status-banner ${versionResult.isOutdated ? 'update-avail' : 'up-to-date'}`}>
            {versionResult.isOutdated ? (
              <div>
                <p>New version v{versionResult.latestVersion} available!</p>
                <button
                  type="button"
                  className="native-primary-btn"
                  onClick={() => openExternalUrl(versionResult.updateUrl)}
                >
                  Update Now
                </button>
              </div>
            ) : (
              <p>✓ Your app is up to date.</p>
            )}
          </div>
        )}
      </div>

      {/* Sign Out */}
      {user && (
        <button
          type="button"
          className="native-signout-btn"
          onClick={() => {
            if (window.confirm('Are you sure you want to sign out?')) {
              clearBiometrics();
              signOut();
              navigate('/');
            }
          }}
        >
          <SignOut width={18} height={18} />
          <span>Sign Out</span>
        </button>
      )}

      <ParentSignInSheet
        open={showSignIn}
        onClose={() => setShowSignIn(false)}
        onDone={() => setShowSignIn(false)}
      />
    </div>
  );
}
