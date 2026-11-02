import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, fetchBlobUrl, mockupUrl, retail, type UniformSet } from '../../../api';
import { Skeleton } from '../../ui/Skeleton';
import { MockupForm, UniformForm } from './UniformForm';
import { FIRST_MODEL_CLASS, prepareFabricPhoto, preparePhoto, renderMockup, type PreparedPhoto } from './mockupEngine';
import { RequestSkeleton, SignedInLogo } from './RetailBits';
import './retail.css';

const SET_STATUS: Record<UniformSet['status'], { label: string; cls: string }> = {
  DRAFT: { label: 'Not live', cls: 's-pending' },
  LIVE: { label: 'Live', cls: 's-approved' },
  HIDDEN: { label: 'Hidden by store owner', cls: 's-cancelled' },
};
const REVIEW_LABEL = { PENDING: 'Check this mock-up', ACCEPTED: 'Accepted', REJECTED: 'Rejected' } as const;
const classRange = (set: UniformSet) => `Class ${set.classes.join(', ')}`;
const forWhom = (set: UniformSet) => (set.gender === 'BOY' ? 'Boys' : 'Girls');
/** The classes in this set that have a model student. */
const modelClasses = (set: UniformSet) => set.classes.filter((c) => c >= FIRST_MODEL_CLASS);

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
          <p className="muted">Add a uniform and choose its classes, then create the mock-ups with a photo, description and sizes. You check them and publish.</p>
        </div>
        <button type="button" className="primary" onClick={() => setAdding(true)} disabled={!store.data || noSchools || !store.data.active}>
          Add uniform
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
                    ) : set.has_photo ? (
                      <SignedInLogo path={retail.clothPhotoPath(set)} alt={`${set.name} uniform`} />
                    ) : (
                      <span className="retail-logo retail-logo-empty">No photo</span>
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
  const [changing, setChanging] = useState(false);
  const set = useQuery({ queryKey: ['retail-uniform', id], queryFn: () => retail.uniform(id) });
  const data = set.data;

  const keep = (fresh: UniformSet) => {
    queryClient.setQueryData(['retail-uniform', id], fresh);
    queryClient.invalidateQueries({ queryKey: ['retail-uniforms'] });
  };

  const action = useMutation({
    mutationFn: (what: 'accept-all' | 'publish' | 'unpublish') => retail.uniformAction(id, what),
    onSuccess: (fresh, what) => {
      setError(null);
      keep(fresh);
      setNotice(what === 'publish' ? 'The set is live.' : null);
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.'),
  });

  const review = useMutation({
    mutationFn: ({ classNo, how }: { classNo: number; how: 'accept' | 'reject' }) => retail.reviewMockup(id, classNo, how),
    onSuccess: (fresh) => {
      setError(null);
      setNotice(null);
      keep(fresh);
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.'),
  });

  /** Makes every mock-up still missing, one class at a time; a class that fails doesn't stop the rest. */
  const make = useMutation({
    mutationFn: async (arg: { uniform: UniformSet; forceAll?: boolean } | UniformSet) => {
      const uniform = 'uniform' in arg ? arg.uniform : arg;
      const forceAll = 'forceAll' in arg ? Boolean(arg.forceAll) : false;
      const ready = forceAll
        ? new Set<number>()
        : new Set(uniform.mockups.filter((m) => m.review !== 'REJECTED').map((m) => m.class_no));
      const url = await fetchBlobUrl(retail.clothPhotoPath(uniform));
      let prepared: PreparedPhoto | null = null;
      try {
        prepared = (await preparePhoto(url, uniform.gender)) ?? (await prepareFabricPhoto(url));
      } finally {
        URL.revokeObjectURL(url);
      }
      if (!prepared) throw new Error('No uniform found');
      const problems: Record<number, string> = {};
      setFailed({});
      for (const classNo of modelClasses(uniform).filter((c) => !ready.has(c))) {
        setMaking(classNo);
        try {
          keep(await retail.saveMockup(uniform.id, classNo, await renderMockup(classNo, uniform.gender, prepared)));
        } catch (err) {
          problems[classNo] = err instanceof ApiError ? err.message : 'Could not make this one.';
          setFailed({ ...problems });
        }
      }
    },
    onSettled: () => setMaking(null),
    onSuccess: () => setError(null),
    onError: () => setError("We couldn't read the clothes or fabric from your photo. Change it for a clear photo of the whole uniform or a close-up of the fabric."),
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

  const classes = data.classes;
  const total = modelClasses(data).length;
  const byClass = new Map(data.mockups.map((m) => [m.class_no, m]));
  const hidden = data.status === 'HIDDEN';
  const missing = total - data.mockups_done;
  const accepted = data.mockups.filter((m) => m.review === 'ACCEPTED').length;
  const rejected = data.mockups.some((m) => m.review === 'REJECTED');
  const toReview = data.mockups.some((m) => m.review === 'PENDING');

  return (
    <div>
      <div className="page-head">
        <div>
          <Link className="link-button" to="/retailer/uniforms">← My uniforms</Link>
          <h1>{data.name}</h1>
          <p className="muted">{data.school_name} · {forWhom(data)} · {classRange(data)} · ₹{data.price.toLocaleString('en-IN')} {data.sizes.length > 0 && ` · Sizes ${data.sizes.join(', ')}`}</p>
          {data.description && <p className="muted">{data.description}</p>}
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
              disabled={hidden || action.isPending || make.isPending || total === 0 || accepted < total}
              title={total === 0 || accepted < total ? 'Accept all the mock-ups first' : undefined}
            >
              Publish
            </button>
          )}
        </div>
      </div>

      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      {hidden && <div className="error" role="alert">The store owner has hidden this set. Contact them to show it again.</div>}

      {(!data.has_photo || changing) && (
        <div className="card">
          <div className="card-head">
            <h2>Create mock-up</h2>
          </div>
          <MockupForm
            set={data}
            onCancel={changing ? () => setChanging(false) : undefined}
            onSaved={(fresh) => {
              setChanging(false);
              setNotice(null);
              keep(fresh);
              make.mutate(fresh);
            }}
          />
        </div>
      )}

      {data.has_photo && !changing && (
        <div className="card">
          <div className="card-head">
            <h2>Your photo</h2>
            <button type="button" className="link-button" onClick={() => setChanging(true)} disabled={hidden || make.isPending}>Change</button>
          </div>
          <div className="pad retail-actions">
            <SignedInLogo path={retail.clothPhotoPath(data)} alt="Your uniform" />
          </div>
        </div>
      )}

      {data.has_photo && <div className="card">
        <div className="card-head">
          <h2>On our model students</h2>
          <span className="muted">{accepted} of {total} accepted</span>
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
                    <span className="muted">{m ? REVIEW_LABEL[m.review] : making === classNo ? 'Making…' : hasModel ? 'Not made yet' : 'Waiting for the model student'}</span>
                    {failed[classNo] && <span className="retail-field-error">{failed[classNo]}</span>}
                    {m && (
                      <span className="retail-actions">
                        <button
                          type="button"
                          className="secondary"
                          disabled={hidden || review.isPending || m.review === 'ACCEPTED'}
                          onClick={() => review.mutate({ classNo, how: 'accept' })}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={hidden || review.isPending || m.review === 'REJECTED'}
                          onClick={() => review.mutate({ classNo, how: 'reject' })}
                        >
                          Reject
                        </button>
                      </span>
                    )}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
        {rejected && (
          <div className="pad retail-reason">
            <p className="retail-hint">You rejected one or more mock-ups. Recreate them to apply updated styling, or change your photo above.</p>
            <div className="retail-actions">
              <button type="button" className="secondary" onClick={() => make.mutate({ uniform: data, forceAll: false })} disabled={hidden || make.isPending}>
                {make.isPending ? 'Making…' : 'Recreate rejected mock-ups'}
              </button>
            </div>
          </div>
        )}
        {toReview && missing === 0 && !make.isPending && (
          <div className="pad retail-actions">
            <button type="button" className="secondary" onClick={() => action.mutate('accept-all')} disabled={hidden || action.isPending}>Accept all waiting</button>
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
      </div>}
    </div>
  );
}
