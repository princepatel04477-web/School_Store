import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, mockupUrl, retail, type Mockup, type UniformSet } from '../../../api';
import { Skeleton } from '../../ui/Skeleton';
import { UniformForm } from './UniformForm';
import { RequestSkeleton, SignedInLogo } from './RetailBits';
import './retail.css';

/** While any mock-up is being made, the screen asks the engine to move on every few seconds. */
const TICK_MS = 4000;

const SET_STATUS: Record<UniformSet['status'], { label: string; cls: string }> = {
  DRAFT: { label: 'Not live', cls: 's-pending' },
  LIVE: { label: 'Live', cls: 's-approved' },
  HIDDEN: { label: 'Hidden by store owner', cls: 's-cancelled' },
};
const MOCKUP_STATUS: Record<Mockup['status'], string> = {
  QUEUED: 'Waiting',
  TOP: 'Fitting the shirt…',
  BOTTOM: 'Fitting the pant or skirt…',
  DONE: 'Ready',
  FAILED: 'Did not work',
};

const working = (set: UniformSet) => set.mockups.some((m) => m.status === 'QUEUED' || m.status === 'TOP' || m.status === 'BOTTOM');
const classRange = (set: UniformSet) => (set.class_from === set.class_to ? `Class ${set.class_from}` : `Class ${set.class_from}–${set.class_to}`);
const forWhom = (set: UniformSet) => (set.gender === 'BOY' ? 'Boys' : 'Girls');

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
          <p className="muted">Add each uniform set with photos of the real shirt and pant or skirt. We show it on our model students for every class, and you publish it.</p>
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
                      <span className="muted">Mock-ups ready: {set.mockups_done} of {set.class_to - set.class_from + 1}</span>
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
  const set = useQuery({ queryKey: ['retail-uniform', id], queryFn: () => retail.uniform(id) });
  const data = set.data;
  const busy = data ? working(data) : false;

  const keep = (fresh: UniformSet) => {
    queryClient.setQueryData(['retail-uniform', id], fresh);
    queryClient.invalidateQueries({ queryKey: ['retail-uniforms'] });
  };
  const onError = (err: unknown) => setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

  // Move the engine on while mock-ups are being made.
  useEffect(() => {
    if (!busy) return undefined;
    const timer = window.setInterval(() => {
      retail.uniformAction(id, 'tick').then(keep).catch(() => undefined);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [busy, id]);

  const action = useMutation({
    mutationFn: (what: 'generate' | 'publish' | 'unpublish') => retail.uniformAction(id, what),
    onSuccess: (fresh, what) => {
      setError(null);
      keep(fresh);
      const missing = 'missing_models' in fresh ? fresh.missing_models ?? [] : [];
      if (what === 'generate' && missing.length) setNotice(`Model students for class ${missing.join(', ')} aren't ready yet, so those mock-ups wait.`);
      else if (what === 'publish') setNotice('The set is live.');
      else setNotice(null);
    },
    onError,
  });
  const again = useMutation({
    mutationFn: ({ classNo, how }: { classNo: number; how: 'retry' | 'another' }) => retail.mockupAgain(id, classNo, how),
    onSuccess: (fresh) => {
      setError(null);
      keep(fresh);
    },
    onError,
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

  const total = data.class_to - data.class_from + 1;
  const classes = Array.from({ length: total }, (_, i) => data.class_from + i);
  const byClass = new Map(data.mockups.map((m) => [m.class_no, m]));
  const hidden = data.status === 'HIDDEN';
  const started = data.mockups.length > 0;

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
              disabled={hidden || action.isPending || data.mockups_done < total}
              title={data.mockups_done < total ? 'All mock-ups must be ready first' : undefined}
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
          <SignedInLogo path={retail.uniformPhotoPath(data.id, 'bottom')} alt={data.gender === 'GIRL' ? 'Skirt' : 'Pant'} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>On our model students</h2>
          <span className="muted">{data.mockups_done} of {total} ready</span>
        </div>
        {!started ? (
          <div className="pad retail-reason">
            <p className="retail-hint">Each mock-up takes about a minute. Keep this page open while they are made.</p>
            <div className="retail-actions">
              <button type="button" className="primary" onClick={() => action.mutate('generate')} disabled={hidden || action.isPending}>
                {action.isPending ? 'Starting…' : 'Make mock-ups'}
              </button>
            </div>
          </div>
        ) : (
          <div className="retail-mockups">
            {classes.map((classNo) => {
              const m = byClass.get(classNo);
              return (
                <figure className="retail-mockup" key={classNo}>
                  {m?.status === 'DONE' && m.image ? (
                    <img src={mockupUrl(m.image)} alt={`${data.name} on the Class ${classNo} model`} loading="lazy" />
                  ) : m && m.status !== 'FAILED' ? (
                    <Skeleton className="retail-mockup-wait" height="100%" />
                  ) : (
                    <span className="retail-mockup-wait retail-logo-empty">{m ? 'Did not work' : 'Model not ready'}</span>
                  )}
                  <figcaption>
                    <b>Class {classNo}</b>
                    <span className="muted">{m ? MOCKUP_STATUS[m.status] : 'Waiting for the model student'}</span>
                    {m?.status === 'FAILED' && (
                      <>
                        {m.error && <span className="retail-field-error">{m.error}</span>}
                        <button type="button" className="link-button" disabled={hidden || again.isPending} onClick={() => again.mutate({ classNo, how: 'retry' })}>
                          Try again
                        </button>
                      </>
                    )}
                    {m?.status === 'DONE' && (
                      <button type="button" className="link-button" disabled={hidden || again.isPending} onClick={() => again.mutate({ classNo, how: 'another' })}>
                        Make another version
                      </button>
                    )}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
        {started && !busy && data.mockups.length < total && (
          <div className="pad">
            <button type="button" className="secondary" onClick={() => action.mutate('generate')} disabled={hidden || action.isPending}>
              Make the missing mock-ups
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
