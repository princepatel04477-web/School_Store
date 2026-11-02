import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, fetchBlobUrl, mockupUrl, retail, type UniformSet } from '../../../api';
import { Skeleton } from '../../ui/Skeleton';
import { UniformForm } from './UniformForm';
import { FIRST_MODEL_CLASS, loadPicture, renderMockup } from './mockupEngine';
import { RequestSkeleton, SignedInLogo } from './RetailBits';
import './retail.css';

const SET_STATUS: Record<UniformSet['status'], { label: string; cls: string }> = {
  DRAFT: { label: 'Not live', cls: 's-pending' },
  LIVE: { label: 'Live', cls: 's-approved' },
  HIDDEN: { label: 'Hidden by store owner', cls: 's-cancelled' },
};
const classRange = (set: UniformSet) => (set.class_from === set.class_to ? `Class ${set.class_from}` : `Class ${set.class_from}–${set.class_to}`);
const forWhom = (set: UniformSet) => (set.gender === 'BOY' ? 'Boys' : 'Girls');
/** The classes in this set that have a model student. */
const modelClasses = (set: UniformSet) =>
  Array.from({ length: set.class_to - set.class_from + 1 }, (_, i) => set.class_from + i).filter((c) => c >= FIRST_MODEL_CLASS);

/** Retailer: their uniform sets. */
export function UniformsList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const store = useQuery({ queryKey: ['retail-my-store'], queryFn: retail.myStore });
  const sets = useQuery({ queryKey: ['retail-uniforms'], queryFn: retail.uniforms });
  const rows = sets.data?.results ?? [];
  const noSchools = store.data && store.data.schools.length === 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">YOUR SHOP</div>
          <h1>My uniforms</h1>
          <p className="muted">Add each uniform set with your shirt photo and a close-up of the pant or skirt cloth. We show it on our model students for every class, and you publish it.</p>
        </div>
        <button type="button" className="primary" onClick={() => setAdding(true)} disabled={!store.data || noSchools || !store.data.active}>
          Add uniform set
        </button>
      </div>

      {noSchools && (
        <div className="notice" role="status">
          You need an approved school first. <Link className="link-button" to="/retailer">Request a school</Link>
        </div>
      )}

      <div className="card">
        {sets.isLoading ? (
          <RequestSkeleton />
        ) : sets.isError ? (
          <div className="pad">
            <div className="error" role="alert">
              Could not load your uniforms.{' '}
              <button type="button" className="link-button" onClick={() => sets.refetch()}>Try again</button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="pad"><div className="empty slim">No uniform sets yet.</div></div>
        ) : (
          <div className="retail-requests">
            {rows.map((set) => {
              const cover = set.mockups.find((m) => m.image);
              return (
                <Link className="retail-request retail-set-row" key={set.id} to={`/retailer/uniforms/${set.id}`}>
                  <div className="retail-request-head">
                    {cover?.image ? (
                      <img className="retail-logo" src={mockupUrl(cover.image)} alt={`${set.name} on the model`} loading="lazy" />
                    ) : (
                      <SignedInLogo path={retail.uniformPhotoPath(set.id, 'top')} alt={`${set.name} shirt`} />
                    )}
                    <div className="retail-request-meta">
                      <h3>{set.name}</h3>
                      <span>{set.school_name} · {forWhom(set)} · {classRange(set)} · ₹{set.price.toLocaleString('en-IN')}</span>
                      <span className="muted">Mock-ups ready: {set.mockups_done} of {modelClasses(set).length}</span>
                      <span><span className={`badge ${SET_STATUS[set.status].cls}`}>{SET_STATUS[set.status].label}</span></span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {adding && store.data && (
        <UniformForm
          store={store.data}
          onClose={() => setAdding(false)}
          onAdded={(set) => {
            setAdding(false);
            queryClient.invalidateQueries({ queryKey: ['retail-uniforms'] });
            navigate(`/retailer/uniforms/${set.id}`);
          }}
        />
      )}
    </div>
  );
}

/** Retailer: one set, its real photos, and its mock-ups on the model students. */
export function UniformDetail() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState<number | null>(null);
  const [failed, setFailed] = useState<Record<number, string>>({});
  const set = useQuery({ queryKey: ['retail-uniform', id], queryFn: () => retail.uniform(id) });
  const data = set.data;

  const keep = (fresh: UniformSet) => {
    queryClient.setQueryData(['retail-uniform', id], fresh);
    queryClient.invalidateQueries({ queryKey: ['retail-uniforms'] });
  };

  const action = useMutation({
    mutationFn: (what: 'publish' | 'unpublish') => retail.uniformAction(id, what),
    onSuccess: (fresh, what) => {
      setError(null);
      keep(fresh);
      setNotice(what === 'publish' ? 'The set is live.' : null);
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.'),
  });

  /** Makes every mock-up still missing, one class at a time; a class that fails doesn't stop the rest. */
  const make = useMutation({
    mutationFn: async (uniform: UniformSet) => {
      const ready = new Set(uniform.mockups.map((m) => m.class_no));
      const cloth = await fetchBlobUrl(retail.uniformPhotoPath(uniform.id, 'bottom')).then(async (url) => {
        try {
          return await loadPicture(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      });
      const problems: Record<number, string> = {};
      setFailed({});
      for (const classNo of modelClasses(uniform).filter((c) => !ready.has(c))) {
        setMaking(classNo);
        try {
          keep(await retail.saveMockup(uniform.id, classNo, await renderMockup(classNo, uniform.gender, cloth)));
        } catch (err) {
          problems[classNo] = err instanceof ApiError ? err.message : 'Could not make this one.';
          setFailed({ ...problems });
        }
      }
    },
    onSettled: () => setMaking(null),
    onSuccess: () => setError(null),
    onError: () => setError('Could not read your cloth photo. Check your connection and try again.'),
  });

  if (set.isLoading) {
    return (
      <div className="card">
        <RequestSkeleton rows={2} />
      </div>
    );
  }
  if (set.isError || !data) {
    return (
      <div className="pad">
        <div className="error" role="alert">
          Could not load this set. <Link className="link-button" to="/retailer/uniforms">Back to my uniforms</Link>
        </div>
      </div>
    );
  }

  const classes = Array.from({ length: data.class_to - data.class_from + 1 }, (_, i) => data.class_from + i);
  const total = modelClasses(data).length;
  const byClass = new Map(data.mockups.map((m) => [m.class_no, m]));
  const hidden = data.status === 'HIDDEN';
  const missing = total - data.mockups_done;

  return (
    <div>
      <div className="page-head">
        <div>
          <Link className="link-button" to="/retailer/uniforms">← My uniforms</Link>
          <h1>{data.name}</h1>
          <p className="muted">{data.school_name} · {forWhom(data)} · {classRange(data)} · ₹{data.price.toLocaleString('en-IN')} · Sizes {data.sizes.join(', ')}</p>
        </div>
        <div className="retail-actions">
          <span className={`badge ${SET_STATUS[data.status].cls}`}>{SET_STATUS[data.status].label}</span>
          {data.status === 'LIVE' ? (
            <button type="button" className="secondary" onClick={() => action.mutate('unpublish')} disabled={action.isPending}>Take down</button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => action.mutate('publish')}
              disabled={hidden || action.isPending || make.isPending || total === 0 || missing > 0}
              title={total === 0 || missing > 0 ? 'All mock-ups must be ready first' : undefined}
            >
              Publish
            </button>
          )}
        </div>
      </div>

      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      {hidden && <div className="error" role="alert">The store owner has hidden this set. Contact them to show it again.</div>}

      <div className="card">
        <div className="card-head">
          <h2>Your photos</h2>
        </div>
        <div className="pad retail-actions">
          <SignedInLogo path={retail.uniformPhotoPath(data.id, 'top')} alt="Shirt" />
          <SignedInLogo path={retail.uniformPhotoPath(data.id, 'bottom')} alt={data.gender === 'GIRL' ? 'Skirt cloth' : 'Pant cloth'} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>On our model students</h2>
          <span className="muted">{data.mockups_done} of {total} ready</span>
        </div>
        {total === 0 && (
          <div className="pad"><div className="empty slim">The model student for this class isn't ready yet.</div></div>
        )}
        {total > 0 && (
          <div className="retail-mockups">
            {classes.map((classNo) => {
              const m = byClass.get(classNo);
              const hasModel = classNo >= FIRST_MODEL_CLASS;
              return (
                <figure className="retail-mockup" key={classNo}>
                  {m?.image ? (
                    <img src={mockupUrl(m.image)} alt={`${data.name} on the Class ${classNo} model`} loading="lazy" />
                  ) : making === classNo ? (
                    <Skeleton className="retail-mockup-wait" height="100%" />
                  ) : (
                    <span className="retail-mockup-wait retail-logo-empty">{hasModel ? 'Not made yet' : 'Model not ready'}</span>
                  )}
                  <figcaption>
                    <b>Class {classNo}</b>
                    <span className="muted">{m ? 'Ready' : making === classNo ? 'Making…' : hasModel ? 'Not made yet' : 'Waiting for the model student'}</span>
                    {failed[classNo] && <span className="retail-field-error">{failed[classNo]}</span>}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
        {missing > 0 && (
          <div className="pad retail-reason">
            <p className="retail-hint">Keep this page open while they are made. It takes a few seconds.</p>
            <div className="retail-actions">
              <button type="button" className="primary" onClick={() => make.mutate(data)} disabled={hidden || make.isPending}>
                {make.isPending ? 'Making…' : data.mockups_done > 0 ? 'Make the missing mock-ups' : 'Make mock-ups'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
