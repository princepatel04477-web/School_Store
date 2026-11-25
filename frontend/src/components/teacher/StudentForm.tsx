import { useEffect, useState } from 'react';
import { api, ApiError, sendForm } from '../../api';
import { compressImage } from '../../utils/imageCompression';
import { StudentPhoto } from './StudentPhoto';
import './teacher.css';

export const STANDARDS = [
  'Nursery', 'Junior KG', 'Senior KG',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

export type TeacherStudent = {
  id: string;
  name: string;
  gr_number: string;
  class_name: string;
  grade_name?: string | null;
  section: string;
  gender: string;
  date_of_birth?: string | null;
  blood_group?: string;
  father_or_guardian_name?: string;
  roster_phone?: string;
  address?: string;
  photo_url?: string | null;
  photo_consent_at?: string | null;
  school?: string;
  school_name?: string;
  branch?: string | null;
  branch_name?: string | null;
  city?: string | null;
  grade?: string | null;
};

/** The server keeps "Class 1"; the picker uses "1". Map either form to a picker value. */
export function toStandard(value?: string | null): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  const bare = raw.replace(/^(class|std|standard|grade)\s+/i, '').trim();
  const lower = bare.toLowerCase();
  if (['jr kg', 'junior kg', 'lkg'].includes(lower)) return 'Junior KG';
  if (['sr kg', 'senior kg', 'ukg'].includes(lower)) return 'Senior KG';
  return STANDARDS.find((c) => c.toLowerCase() === lower) || raw;
}

export function standardLabel(value?: string | null) {
  if (!value) return '-';
  if (/^class\s/i.test(value)) return value;
  return /^\d+$/.test(value) ? `Class ${value}` : value;
}

/** What the ID card still needs before it can be printed. */
export function missingForIdCard(s: TeacherStudent): string[] {
  const missing: string[] = [];
  if (!s.photo_url) missing.push('photo');
  if (!s.date_of_birth) missing.push('date of birth');
  if (!s.blood_group) missing.push('blood group');
  if (!s.father_or_guardian_name) missing.push('parent name');
  if (!s.roster_phone) missing.push('parent phone');
  if (!s.address) missing.push('address');
  return missing;
}

type Props = {
  student?: TeacherStudent | null;
  defaults?: { class_name?: string; section?: string };
  schoolId?: string;
  branchId?: string;
  /** `warning` is set when the details saved but the photo did not. */
  onSaved: (student: TeacherStudent, warning?: string) => void;
};

/** One student's ID card form: details and photo. Used to add a student and to fill or fix one. */
export function StudentForm({ student, defaults, schoolId, branchId, onSaved }: Props) {
  const isNew = !student;
  const [name, setName] = useState(student?.name || '');
  const [grNumber, setGrNumber] = useState(student?.gr_number || '');
  const [className, setClassName] = useState(
    toStandard(student?.class_name || student?.grade_name || defaults?.class_name) || '1',
  );
  const [section, setSection] = useState(student?.section || defaults?.section || 'A');
  const [gender, setGender] = useState(student?.gender?.toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE');
  const [dob, setDob] = useState(student?.date_of_birth || '');
  const [bloodGroup, setBloodGroup] = useState(student?.blood_group || '');
  const [guardian, setGuardian] = useState(student?.father_or_guardian_name || '');
  const [phone, setPhone] = useState(student?.roster_phone || '');
  const [address, setAddress] = useState(student?.address || '');

  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [consent, setConsent] = useState(Boolean(student?.photo_consent_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setPreparing(true);
    try {
      const { blob } = await compressImage(file, 1200, 900_000, 0.85);
      setPhotoBlob(blob);
      setPhotoPreview(URL.createObjectURL(blob));
    } catch {
      setError('That photo could not be opened. Take it again or choose another one.');
    } finally {
      setPreparing(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const digits = phone.replace(/\D/g, '');
    if (digits && digits.length !== 10) {
      setError('Parent phone must be 10 digits.');
      return;
    }
    if (photoBlob && !consent) {
      setError('Tick that the parent has agreed to this photo before saving it.');
      return;
    }
    if (isNew && !schoolId) {
      setError('Choose a school at the top of the page first.');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        gr_number: grNumber.trim(),
        class_name: className,
        section: section.trim().toUpperCase() || 'A',
        gender,
        date_of_birth: dob || null,
        blood_group: bloodGroup,
        father_or_guardian_name: guardian.trim(),
        roster_phone: digits,
        address: address.trim(),
      };
      if (isNew) {
        if (schoolId) body.school = schoolId;
        if (branchId) body.branch = branchId;
      }
      let saved = await api<TeacherStudent>(isNew ? '/students/' : `/students/${student!.id}/`, {
        method: isNew ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      });
      if (photoBlob) {
        const form = new FormData();
        form.append('photo', photoBlob, 'photo.jpg');
        form.append('consent', '1');
        try {
          saved = await sendForm<TeacherStudent>(`/students/${saved.id}/photo/`, form);
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : 'The photo did not upload.';
          setError(`Details saved, but the photo did not upload: ${msg}`);
          onSaved(saved, `Details saved, but the photo did not upload: ${msg}`);
          return;
        }
      }
      setPhotoBlob(null);
      setPhotoPreview('');
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Check the internet and try again.');
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || preparing;
  const hasPhoto = Boolean(photoPreview || student?.photo_url);

  return (
    <form className="tp-form" onSubmit={submit} noValidate={false}>
      <section className="tp-photo-block" aria-label="ID card photo">
        <StudentPhoto url={student?.photo_url} localUrl={photoPreview} name={name} size={96} />
        <div className="tp-photo-actions">
          <b>ID card photo</b>
          <small>Plain background, face straight to the camera.</small>
          <label className="tp-btn tp-btn-primary">
            {preparing ? 'Preparing photo...' : hasPhoto ? 'Take a new photo' : 'Take photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <label className="tp-btn">
            Choose from gallery
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                void pickPhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </section>

      {(photoBlob || !student?.photo_consent_at) && (
        <label className="tp-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            The parent has agreed that the school may use this photo for the child's ID card.
          </span>
        </label>
      )}
      {student?.photo_consent_at && !photoBlob && (
        <p className="tp-note">
          Parent agreement recorded on {new Date(student.photo_consent_at).toLocaleDateString('en-IN')}.
        </p>
      )}

      <label className="tp-field">
        <span>Student full name *</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
      </label>
      <label className="tp-field">
        <span>GR / roll number *</span>
        <input value={grNumber} onChange={(e) => setGrNumber(e.target.value)} required autoComplete="off" />
      </label>
      <div className="tp-row">
        <label className="tp-field">
          <span>Class *</span>
          <select value={className} onChange={(e) => setClassName(e.target.value)} required>
            {!STANDARDS.includes(className) && <option value={className}>{className}</option>}
            {STANDARDS.map((c) => (
              <option key={c} value={c}>{standardLabel(c)}</option>
            ))}
          </select>
        </label>
        <label className="tp-field">
          <span>Section *</span>
          <input
            value={section}
            onChange={(e) => setSection(e.target.value.toUpperCase())}
            maxLength={10}
            required
          />
        </label>
      </div>
      <div className="tp-row">
        <label className="tp-field">
          <span>Boy or girl</span>
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="MALE">Boy</option>
            <option value="FEMALE">Girl</option>
          </select>
        </label>
        <label className="tp-field">
          <span>Blood group</span>
          <select value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}>
            <option value="">-</option>
            {BLOOD_GROUPS.map((bg) => (
              <option key={bg} value={bg}>{bg}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="tp-field">
        <span>Date of birth</span>
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
      </label>
      <label className="tp-field">
        <span>Father / mother / guardian name</span>
        <input value={guardian} onChange={(e) => setGuardian(e.target.value)} autoComplete="off" />
      </label>
      <label className="tp-field">
        <span>Parent phone (10 digits)</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="numeric"
          maxLength={14}
          autoComplete="off"
        />
      </label>
      <label className="tp-field">
        <span>Home address</span>
        <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
      </label>

      {error && <p className="tp-error" role="alert">{error}</p>}

      <button type="submit" className="tp-btn tp-btn-primary tp-btn-full" disabled={busy}>
        {saving ? 'Saving...' : isNew ? 'Save student' : 'Save form'}
      </button>
    </form>
  );
}
