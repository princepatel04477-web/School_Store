import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { portalApi, teacherAdmin, type User } from '../../api';
import { useAuth } from '../../auth';
import { Skeleton } from '../ui/Skeleton';
import '../teacher/teacher.css';
import './teacherControl.css';

export function TeacherControlView() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canAssignAllSchools = user?.role === 'BOSS' || (user?.role === 'ADMIN' && !user?.city);

  // Location & School selection
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedSchool, setSelectedSchool] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  // A teacher looks after one school unless the developer ticks every school.
  const [allSchools, setAllSchools] = useState(false);

  // Teacher form
  const [teacherName, setTeacherName] = useState('');
  const [teacherPhone, setTeacherPhone] = useState('');
  const [search, setSearch] = useState('');

  // Quick ID-card-only school creation
  const [showAddSchool, setShowAddSchool] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState('');
  const [newSchoolCode, setNewSchoolCode] = useState('');
  const [newSchoolPortalOnly, setNewSchoolPortalOnly] = useState(true);

  // Password visibility & copy feedback
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const { data: citiesData } = useQuery({
    queryKey: ['teacher-admin-cities'],
    queryFn: () => portalApi.cities({ page_size: '200' }),
  });
  const cities = citiesData?.results || [];

  const states = useMemo(() => {
    const set = new Set<string>();
    cities.forEach((c) => {
      if (c.state) set.add(c.state);
    });
    return Array.from(set).sort();
  }, [cities]);

  const filteredCities = useMemo(() => {
    if (!selectedState) return cities;
    return cities.filter((c) => c.state.toLowerCase() === selectedState.toLowerCase());
  }, [cities, selectedState]);

  const { data: schoolsData } = useQuery({
    queryKey: ['teacher-admin-schools'],
    queryFn: () => portalApi.schools({ page_size: '200' }),
  });
  const schools = schoolsData?.results || [];

  const { data: branchesData } = useQuery({
    queryKey: ['teacher-admin-branches', selectedCity, selectedSchool],
    queryFn: () => {
      const p: Record<string, string> = {};
      if (selectedCity) p.city = selectedCity;
      if (selectedSchool) p.school = selectedSchool;
      return portalApi.branches(p);
    },
    enabled: Boolean(selectedCity || selectedSchool),
  });
  const branches = branchesData?.results || [];

  const { data: teachersData, isLoading } = useQuery({
    queryKey: ['teacher-admin-list', search],
    queryFn: () => teacherAdmin.list(search ? { search } : {}),
  });
  const teachers = teachersData?.results || [];

  const createTeacherMutation = useMutation({
    mutationFn: () => {
      const parts = teacherName.trim().split(/\s+/);
      const first_name = parts[0] || '';
      const last_name = parts.slice(1).join(' ');
      return teacherAdmin.create({
        first_name,
        last_name,
        phone: teacherPhone.trim(),
        city: selectedCity || null,
        school: allSchools ? null : selectedSchool || null,
        branch: allSchools ? null : selectedBranch || null,
        all_schools_access: allSchools,
      });
    },
    onSuccess: (created) => {
      setErrorMsg('');
      setTeacherName('');
      setTeacherPhone('');
      setVisiblePasswords((prev) => ({ ...prev, [created.id]: true }));
      setBanner(
        `Login made for ${created.first_name || 'the teacher'}. User ID: ${created.username}, password: ${created.issued_password || '******'}.`
      );
      queryClient.invalidateQueries({ queryKey: ['teacher-admin-list'] });
    },
    onError: (err: any) => {
      setErrorMsg(err?.message || 'Could not create teacher login.');
    },
  });

  const regenMutation = useMutation({
    mutationFn: (id: string) => teacherAdmin.regeneratePassword(id),
    onSuccess: (res) => {
      setErrorMsg('');
      setVisiblePasswords((prev) => ({ ...prev, [res.id]: true }));
      setBanner(`New password for user ID ${res.username}: ${res.issued_password}. The old one no longer works and old sign-ins are ended.`);
      queryClient.invalidateQueries({ queryKey: ['teacher-admin-list'] });
    },
    onError: (err: any) => {
      setErrorMsg(err?.message || 'Could not regenerate password.');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      teacherAdmin.toggleActive(id, active),
    onSuccess: (updated) => {
      setErrorMsg('');
      setBanner(
        updated.is_active
          ? `${updated.first_name || 'Teacher'} can sign in again.`
          : `${updated.first_name || 'Teacher'} is paused and signed out on every phone.`,
      );
      queryClient.invalidateQueries({ queryKey: ['teacher-admin-list'] });
    },
    onError: (err: any) => setErrorMsg(err?.message || 'Could not change this login.'),
  });

  const createSchoolMutation = useMutation({
    mutationFn: () =>
      portalApi.addSchool({
        name: newSchoolName.trim(),
        code: newSchoolCode.trim().toUpperCase(),
        city: selectedCity,
        active: true,
        is_public_store: !newSchoolPortalOnly,
      } as any),
    onSuccess: (school) => {
      setShowAddSchool(false);
      setNewSchoolName('');
      setNewSchoolCode('');
      setSelectedSchool(school.id);
      setAllSchools(false);
      setBanner(`School "${school.name}" added${newSchoolPortalOnly ? ' (teacher ID card portal only)' : ''}.`);
      queryClient.invalidateQueries({ queryKey: ['teacher-admin-schools'] });
    },
    onError: (err: any) => {
      setErrorMsg(err?.message || 'Could not create school.');
    },
  });

  const copyCredentials = async (t: User) => {
    const pass = t.issued_password || '(tap New password first)';
    const text = `SchoolStore Teacher Login\nUser ID: ${t.username}\nPassword: ${pass}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(t.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setBanner(text);
    }
  };

  return (
    <div className="tc">
      <section className="tc-card">
        <div className="tc-head">
          <div>
            <h2>Teacher logins</h2>
            <p>
              Make a 6-digit user ID and password for each teacher. A teacher can add classes (1A, 1B),
              add students and fill every student's ID card form with photo for their school.
            </p>
          </div>
          <button type="button" className="tp-btn tp-btn-sm" onClick={() => setShowAddSchool((v) => !v)}>
            {showAddSchool ? 'Close' : '+ Add ID card school'}
          </button>
        </div>

        {banner && <p className="tc-banner" role="status">{banner}</p>}
        {errorMsg && <p className="tp-error" role="alert">{errorMsg}</p>}

        {showAddSchool && (
          <form
            className="tc-sub"
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedCity) {
                setErrorMsg('Choose a city first, then add the school.');
                return;
              }
              createSchoolMutation.mutate();
            }}
          >
            <b>Add a school (for example for ID cards only)</b>
            <label className="tp-field">
              <span>City *</span>
              <select value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)} required>
                <option value="">Choose city</option>
                {filteredCities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.state})</option>
                ))}
              </select>
            </label>
            <label className="tp-field">
              <span>School name *</span>
              <input value={newSchoolName} onChange={(e) => setNewSchoolName(e.target.value)} required />
            </label>
            <label className="tp-field">
              <span>Short code *</span>
              <input
                value={newSchoolCode}
                onChange={(e) => setNewSchoolCode(e.target.value)}
                placeholder="For example KV-ID-01"
                required
              />
            </label>
            <label className="tp-consent">
              <input
                type="checkbox"
                checked={newSchoolPortalOnly}
                onChange={(e) => setNewSchoolPortalOnly(e.target.checked)}
              />
              <span>Show only in the teacher ID card portal (hide from the parent store)</span>
            </label>
            <button type="submit" className="tp-btn tp-btn-primary" disabled={createSchoolMutation.isPending}>
              {createSchoolMutation.isPending ? 'Saving...' : 'Save school'}
            </button>
          </form>
        )}

        <form
          className="tc-sub"
          onSubmit={(e) => {
            e.preventDefault();
            if (!allSchools && !selectedSchool) {
              setErrorMsg('Choose the school this teacher will look after.');
              return;
            }
            createTeacherMutation.mutate();
          }}
        >
          <b>New teacher login</b>
          {canAssignAllSchools && (
            <label className="tp-consent">
              <input type="checkbox" checked={allSchools} onChange={(e) => setAllSchools(e.target.checked)} />
              <span>Give this teacher every school (only for your own staff)</span>
            </label>
          )}

          {!allSchools && (
            <>
              <div className="tp-row">
                <label className="tp-field">
                  <span>State</span>
                  <select
                    value={selectedState}
                    onChange={(e) => {
                      setSelectedState(e.target.value);
                      setSelectedCity('');
                      setSelectedBranch('');
                    }}
                  >
                    <option value="">Any</option>
                    {states.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </label>
                <label className="tp-field">
                  <span>City</span>
                  <select
                    value={selectedCity}
                    onChange={(e) => {
                      setSelectedCity(e.target.value);
                      setSelectedBranch('');
                    }}
                  >
                    <option value="">Any</option>
                    {filteredCities.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="tp-field">
                <span>School *</span>
                <select
                  value={selectedSchool}
                  onChange={(e) => {
                    setSelectedSchool(e.target.value);
                    setSelectedBranch('');
                  }}
                  required
                >
                  <option value="">Choose school</option>
                  {schools.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.is_public_store === false ? ' (ID card only)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="tp-field">
                <span>Branch</span>
                <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)}>
                  <option value="">Whole school (every branch)</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.display_name} ({b.city_name})</option>
                  ))}
                </select>
              </label>
            </>
          )}

          <label className="tp-field">
            <span>Teacher name *</span>
            <input
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              placeholder="For example Ramesh Sharma"
              required
            />
          </label>
          <label className="tp-field">
            <span>Mobile number</span>
            <input value={teacherPhone} onChange={(e) => setTeacherPhone(e.target.value)} inputMode="numeric" />
          </label>
          <button type="submit" className="tp-btn tp-btn-primary" disabled={createTeacherMutation.isPending}>
            {createTeacherMutation.isPending ? 'Making login...' : 'Make 6-digit ID and password'}
          </button>
        </form>
      </section>

      <section className="tc-card">
        <div className="tc-head">
          <h3>All teachers ({teachers.length})</h3>
        </div>
        <label className="tp-field">
          <span>Search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, 6-digit ID or phone"
          />
        </label>

        {isLoading ? (
          <div className="tp-skeleton-list" role="status" aria-label="Loading teachers">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height="120px" />
            ))}
          </div>
        ) : teachers.length === 0 ? (
          <p className="tp-note">No teachers yet. Use the form above to make the first login.</p>
        ) : (
          <ul className="tc-list">
            {teachers.map((t) => {
              const shown = !!visiblePasswords[t.id];
              const fullName = [t.first_name, t.last_name].filter(Boolean).join(' ') || 'Teacher';
              return (
                <li key={t.id} className="tc-teacher">
                  <div className="tc-teacher-top">
                    <div>
                      <b>{fullName}</b>
                      <small>
                        {t.all_schools_access
                          ? 'Every school'
                          : `${t.school_name || 'School not set'}${t.branch_name ? `, ${t.branch_name}` : ', whole school'}`}
                      </small>
                      {t.phone && <small>{t.phone}</small>}
                    </div>
                    <span className={t.is_active ? 'tc-status tc-status-on' : 'tc-status tc-status-off'}>
                      {t.is_active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <dl className="tc-creds">
                    <div>
                      <dt>User ID</dt>
                      <dd>{t.username}</dd>
                    </div>
                    <div>
                      <dt>Password</dt>
                      <dd>{t.issued_password ? (shown ? t.issued_password : '******') : '-'}</dd>
                    </div>
                  </dl>
                  <div className="tc-actions">
                    {t.issued_password && (
                      <button
                        type="button"
                        className="tp-btn tp-btn-sm"
                        onClick={() => setVisiblePasswords((prev) => ({ ...prev, [t.id]: !prev[t.id] }))}
                      >
                        {shown ? 'Hide' : 'Show'}
                      </button>
                    )}
                    <button type="button" className="tp-btn tp-btn-sm" onClick={() => copyCredentials(t)}>
                      {copiedId === t.id ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      className="tp-btn tp-btn-sm"
                      disabled={regenMutation.isPending}
                      onClick={() => regenMutation.mutate(t.id)}
                    >
                      New password
                    </button>
                    <button
                      type="button"
                      className="tp-btn tp-btn-sm"
                      onClick={() => toggleActiveMutation.mutate({ id: t.id, active: !t.is_active })}
                    >
                      {t.is_active ? 'Pause' : 'Turn on'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
