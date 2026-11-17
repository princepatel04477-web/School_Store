import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api, deleteChildPhotos } from '../../api';
import { useAuth } from '../../auth';
import { useLang, LANGUAGES } from '../../i18n';
import { User, ShieldCheck, SignOut, ChevronRight } from '../../components/ui/icons';
import { ParentSignInSheet } from '../../components/parent/ParentSignInSheet';
import './nativePages.css';

export function ProfileTab() {
  const { user, signOut } = useAuth();
  const { lang, setLang } = useLang();
  const navigate = useNavigate();
  const [showSignIn, setShowSignIn] = useState(false);
  const [photoDeleteStatus, setPhotoDeleteStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');

  const { data: studentsData } = useQuery({
    queryKey: ['profile-students', user?.id],
    queryFn: () => api<{ results: any[] }>('/students/').catch(() => null),
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
            <h3>{user.username}</h3>
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
              Sign in with phone
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
              {students.map((child: any) => (
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

      {/* Sign Out */}
      {user && (
        <button
          type="button"
          className="native-signout-btn"
          onClick={() => {
            if (window.confirm('Are you sure you want to sign out?')) {
              signOut();
              navigate('/');
            }
          }}
        >
          <SignOut width={18} height={18} />
          <span>Sign Out</span>
        </button>
      )}

      <div className="native-app-version">
        School Store Native App · v1.0.0 (Build 1)
      </div>

      <ParentSignInSheet
        open={showSignIn}
        onClose={() => setShowSignIn(false)}
        onDone={() => setShowSignIn(false)}
      />
    </div>
  );
}
