import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { portalApi, teacherAdmin, type User } from '../../api';

export function TeacherControlView() {
  const queryClient = useQueryClient();

  // Location & School selection
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedSchool, setSelectedSchool] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [allSchools, setAllSchools] = useState(true);

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
        `Created Teacher Login — ID: ${created.username} | Password: ${created.issued_password || '******'}`
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
      setBanner(`New Password generated for ID ${res.username}: ${res.issued_password}`);
      queryClient.invalidateQueries({ queryKey: ['teacher-admin-list'] });
    },
    onError: (err: any) => {
      setErrorMsg(err?.message || 'Could not regenerate password.');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      teacherAdmin.toggleActive(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-admin-list'] });
    },
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
      setBanner(`School "${school.name}" added${newSchoolPortalOnly ? ' (ID Card Portal only)' : ''}.`);
      queryClient.invalidateQueries({ queryKey: ['teacher-admin-schools'] });
    },
    onError: (err: any) => {
      setErrorMsg(err?.message || 'Could not create school.');
    },
  });

  const copyCredentials = async (t: User) => {
    const pass = t.issued_password || '(regenerate to view)';
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
    <div style={{ display: 'grid', gap: '20px' }}>
      <div className="portal-card" style={{ padding: '20px', background: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px' }}>Teacher & ID Card Access Portal</h2>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '14px' }}>
              Create simple 6-digit logins for teachers. View, copy, or regenerate passwords anytime to share.
            </p>
          </div>
          <button
            type="button"
            className="portal-btn portal-btn-secondary portal-btn-sm"
            onClick={() => setShowAddSchool((v) => !v)}
          >
            {showAddSchool ? 'Close Add School' : '+ Add ID-Card School'}
          </button>
        </div>

        {banner && (
          <div style={{ padding: '12px 14px', borderRadius: '8px', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', marginBottom: '14px', fontWeight: 600 }}>
            {banner}
          </div>
        )}
        {errorMsg && (
          <div style={{ padding: '12px 14px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', marginBottom: '14px' }}>
            {errorMsg}
          </div>
        )}

        {showAddSchool && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedCity) {
                setErrorMsg('Please select a City first before adding a school.');
                return;
              }
              createSchoolMutation.mutate();
            }}
            style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '18px', display: 'grid', gap: '12px' }}
          >
            <strong style={{ fontSize: '15px' }}>Add a School (e.g. for ID Cards only)</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                required
                style={{ padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="">Select City *</option>
                {filteredCities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.state})</option>
                ))}
              </select>
              <input
                value={newSchoolName}
                onChange={(e) => setNewSchoolName(e.target.value)}
                placeholder="School Name (e.g. Kendriya Vidyalaya)"
                required
                style={{ padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
              <input
                value={newSchoolCode}
                onChange={(e) => setNewSchoolCode(e.target.value)}
                placeholder="Short Code (e.g. KV-ID-01)"
                required
                style={{ padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <input
                type="checkbox"
                checked={newSchoolPortalOnly}
                onChange={(e) => setNewSchoolPortalOnly(e.target.checked)}
              />
              Show only in Teacher / ID Card Portal (hide from public parent store)
            </label>
            <div>
              <button type="submit" className="portal-btn portal-btn-primary portal-btn-sm" disabled={createSchoolMutation.isPending}>
                {createSchoolMutation.isPending ? 'Saving...' : 'Save School'}
              </button>
            </div>
          </form>
        )}

        {/* Step 1: State -> City -> School -> Branch */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createTeacherMutation.mutate();
          }}
          style={{ display: 'grid', gap: '14px', padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <strong style={{ fontSize: '15px' }}>1. Choose School Access & Create 6-Digit Teacher Login</strong>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600, color: '#0f766e' }}>
              <input
                type="checkbox"
                checked={allSchools}
                onChange={(e) => setAllSchools(e.target.checked)}
              />
              Give access to ALL Schools & Classes (Class 1 to 12)
            </label>
          </div>

          {!allSchools && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <select
                value={selectedState}
                onChange={(e) => {
                  setSelectedState(e.target.value);
                  setSelectedCity('');
                  setSelectedBranch('');
                }}
                style={{ padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="">1. Select State (Optional)</option>
                {states.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>

              <select
                value={selectedCity}
                onChange={(e) => {
                  setSelectedCity(e.target.value);
                  setSelectedBranch('');
                }}
                style={{ padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="">2. Select City</option>
                {filteredCities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <select
                value={selectedSchool}
                onChange={(e) => {
                  setSelectedSchool(e.target.value);
                  setSelectedBranch('');
                }}
                required={!allSchools}
                style={{ padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="">3. Select School *</option>
                {schools.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.is_public_store === false ? '(ID Card Only)' : ''}
                  </option>
                ))}
              </select>

              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                style={{ padding: '9px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="">4. Select Branch (if applicable)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.display_name} ({b.city_name})</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', alignItems: 'center' }}>
            <input
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              placeholder="Teacher Name (e.g. Ramesh Sharma) *"
              required
              style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
            <input
              value={teacherPhone}
              onChange={(e) => setTeacherPhone(e.target.value)}
              placeholder="Mobile Number (Optional)"
              style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
            <button
              type="submit"
              className="portal-btn portal-btn-primary"
              disabled={createTeacherMutation.isPending}
            >
              {createTeacherMutation.isPending ? 'Generating...' : 'Generate 6-Digit ID & Password'}
            </button>
          </div>
        </form>
      </div>

      {/* Teacher Credentials Table */}
      <div className="portal-card" style={{ padding: '20px', background: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, fontSize: '17px' }}>All Teachers ({teachers.length})</h3>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, 6-digit ID, or phone..."
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', minWidth: '250px' }}
          />
        </div>

        {isLoading ? (
          <p style={{ color: '#64748b' }}>Loading teachers...</p>
        ) : teachers.length === 0 ? (
          <p style={{ color: '#64748b' }}>No teachers created yet. Use the form above to generate a 6-digit ID & password.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                  <th style={{ padding: '10px 8px' }}>Teacher</th>
                  <th style={{ padding: '10px 8px' }}>School / Access</th>
                  <th style={{ padding: '10px 8px' }}>6-Digit User ID</th>
                  <th style={{ padding: '10px 8px' }}>6-Digit Password</th>
                  <th style={{ padding: '10px 8px' }}>Status</th>
                  <th style={{ padding: '10px 8px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((t) => {
                  const shown = !!visiblePasswords[t.id];
                  const fullName = [t.first_name, t.last_name].filter(Boolean).join(' ') || 'Teacher';
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 8px' }}>
                        <strong>{fullName}</strong>
                        {t.phone && <div style={{ fontSize: '12px', color: '#64748b' }}>{t.phone}</div>}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        {t.all_schools_access ? (
                          <span style={{ padding: '3px 8px', borderRadius: '999px', background: '#dcfce7', color: '#166534', fontSize: '12px', fontWeight: 600 }}>
                            All Schools (Class 1–12)
                          </span>
                        ) : (
                          <div>
                            <div>{t.school_name || 'Assigned School'}</div>
                            {t.branch_name && <div style={{ fontSize: '12px', color: '#64748b' }}>{t.branch_name}</div>}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '15px', fontWeight: 700 }}>
                        {t.username}
                      </td>
                      <td style={{ padding: '10px 8px', fontFamily: 'monospace', fontSize: '15px' }}>
                        <span style={{ fontWeight: 700, marginRight: '8px' }}>
                          {t.issued_password ? (shown ? t.issued_password : '••••••') : 'Not set'}
                        </span>
                        {t.issued_password && (
                          <button
                            type="button"
                            onClick={() => setVisiblePasswords((prev) => ({ ...prev, [t.id]: !prev[t.id] }))}
                            style={{ fontSize: '12px', padding: '2px 7px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
                          >
                            {shown ? 'Hide' : 'Show'}
                          </button>
                        )}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <span style={{ color: t.is_active ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
                          {t.is_active ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="portal-btn portal-btn-secondary portal-btn-sm"
                            onClick={() => copyCredentials(t)}
                          >
                            {copiedId === t.id ? 'Copied!' : 'Copy'}
                          </button>
                          <button
                            type="button"
                            className="portal-btn portal-btn-secondary portal-btn-sm"
                            disabled={regenMutation.isPending}
                            onClick={() => regenMutation.mutate(t.id)}
                          >
                            Regenerate
                          </button>
                          <button
                            type="button"
                            className="portal-btn portal-btn-secondary portal-btn-sm"
                            onClick={() => toggleActiveMutation.mutate({ id: t.id, active: !t.is_active })}
                          >
                            {t.is_active ? 'Pause' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
