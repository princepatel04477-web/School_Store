import { Preferences } from '@capacitor/preferences';
import { isNativeApp } from './native/nativePlatform';
import { purgeSavedData } from './store/persist';

export type Role='PARENT'|'TEACHER'|'SCHOOL_ADMIN'|'ADMIN'|'BOSS'|'RETAILER';
export type User={id:string;username:string;role:Role;city?:string|null;city_name?:string|null;city_state?:string|null;school?:{name:string}|string|null;school_name?:string|null;school_code?:string|null;branch?:string|null;branch_name?:string|null;all_schools_access?:boolean;issued_password?:string|null;phone?:string;email?:string;first_name?:string;last_name?:string;is_active?:boolean;created_at?:string};
export type CustomisationField = {
  key: string;
  label: string;
  type: 'text' | 'select' | 'image' | 'image_url';
  required?: boolean;
  options?: string[];
  max_length?: number;
  limits?: {
    max_bytes?: number;
    accept?: string[];
  };
};

export type StockStatus='IN_STOCK'|'LOW_STOCK'|'OUT_OF_STOCK';
export type Product={
  id:string;
  name:string;
  category:string;
  category_slug?:string;
  product_type?:'SOCKS'|'BELT'|'TIE'|string|null;
  price:number;
  gender?:'boy'|'girl'|'unisex'|null;
  needs_review?:boolean;
  school?:string|null;
  image?:string;
  thumbnail?:string|null;
  customisation_schema?:CustomisationField[] | {fields?: CustomisationField[]};
  variants:{id:string;size:string;stock_status:StockStatus|null}[];
};
export type OrderTrackingStep = {
  key: string;
  at: string;
};

export type OrderTracking = {
  carrier: 'INDIA_POST' | null;
  consignment_number: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  steps: OrderTrackingStep[];
};

export type OrderItemDetail = {
  id: string;
  product_name: string;
  variant_sku?: string;
  variant_size?: string;
  size?: string;
  quantity: number;
  unit_price_snapshot: string | number;
  customisation_data?: Record<string, unknown>;
  customisation_display?: Record<string, unknown>;
};

export type OrderQuoteLine = {
  variant: string;
  sku: string;
  name: string;
  size: string;
  quantity: number;
  unit_price: string;
  line_total: string;
};

export type OrderQuote = {
  lines: OrderQuoteLine[];
  subtotal: string;
  total: string;
  total_paise: number;
  currency: 'INR';
  payment_methods: ('COD' | 'ONLINE')[];
  reservation_minutes: number;
};

export type PaymentView = {
  state: 'PAID' | 'CHECKING' | 'NOT_PAID' | 'RELEASED' | 'REFUND_DUE' | 'COD_DUE' | 'PAID_DO_NOT_COLLECT';
  amount_due_paise: number;
  amount_paid_paise: number;
  currency: 'INR';
  hold_expires_at: string | null;
  last_checked_at: string | null;
  last_check_ok: boolean | null;
  in_progress: boolean;
  last_failure_reason: string | null;
  can_pay_now: boolean;
  can_switch_to_cod: boolean;
  can_refresh: boolean;
  receipt: { order_number: string; amount_paise: number; paid_at: string; method: string; payment_ref_last4: string } | null;
};

export type PaymentReconcileResponse = { checked: boolean; retry_after_seconds: number; payment_view: PaymentView };

export type Order = {
  id: string;
  order_number: string;
  student?: string;
  student_name: string;
  student_gr?: string;
  school_code?: string;
  school_name?: string;
  city_name?: string;
  placed_by_role?: string;
  status: string;
  payment_status: string;
  payment_method?: 'COD' | 'ONLINE' | string;
  fulfillment_type?: string;
  subtotal?: string | number;
  total: number | string;
  payment_view?: PaymentView;
  razorpay_order_id?: string;
  tracking?: OrderTracking;
  created_at: string;
  status_events?: { status: string; timestamp: string }[];
  items?: OrderItemDetail[];
};
const API=import.meta.env.VITE_API_URL||'/api';

/** Turns an API path into a full URL. Paths may be "/panel/..." or "/api/panel/...". */
export function toUrl(path:string):string{
  const cleanPath=path.startsWith('/')?path:`/${path}`;
  const base=API.replace(/\/+$/,'');
  if(cleanPath.startsWith('/api/')){
    return `${base}${cleanPath.slice(4)}`;
  }
  return `${base}${cleanPath}`;
}

let cachedAccess:string|null=null;
let cachedRefresh:string|null=null;
let prefInitPromise:Promise<void>|null=null;

async function ensurePrefLoaded():Promise<void>{
  if(!isNativeApp()) return;
  if(!prefInitPromise){
    prefInitPromise=(async()=>{
      const [acc,ref]=await Promise.all([
        Preferences.get({key:'access'}),
        Preferences.get({key:'refresh'}),
      ]);
      cachedAccess=acc.value;
      cachedRefresh=ref.value;
    })();
  }
  return prefInitPromise;
}

export async function getStoredToken(key:'access'|'refresh'):Promise<string|null>{
  if(isNativeApp()){
    await ensurePrefLoaded();
    return key==='access'?cachedAccess:cachedRefresh;
  }
  return localStorage.getItem(key);
}

export async function setStoredTokens(tokens:{access:string;refresh?:string}):Promise<void>{
  if(isNativeApp()){
    cachedAccess=tokens.access;
    await Preferences.set({key:'access',value:tokens.access});
    if(tokens.refresh!==undefined){
      cachedRefresh=tokens.refresh;
      await Preferences.set({key:'refresh',value:tokens.refresh});
    }
  }else{
    localStorage.setItem('access',tokens.access);
    if(tokens.refresh!==undefined){
      localStorage.setItem('refresh',tokens.refresh);
    }
  }
}

export async function clearStoredTokens():Promise<void>{
  if(isNativeApp()){
    cachedAccess=null;
    cachedRefresh=null;
    await Promise.all([
      Preferences.remove({key:'access'}),
      Preferences.remove({key:'refresh'}),
    ]);
  }else{
    localStorage.removeItem('access');
    localStorage.removeItem('refresh');
  }
}

let refreshing:Promise<string>|null=null;
async function refresh():Promise<string>{
  const token=await getStoredToken('refresh');
  const r=await fetch(toUrl('/auth/token/refresh/'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh:token})});
  if(!r.ok) throw Error('session expired');
  const d=await r.json();
  await setStoredTokens({access:d.access});
  return d.access;
}

/** A request the server answered with an error; keeps the status and body so callers can tell a refusal from an outage. */
export class ApiError extends Error{constructor(message:string,public status:number,public data:Record<string,unknown>={}){super(message);this.name='ApiError';}}
export async function api<T>(path:string, init:RequestInit={},{retry=true}={}):Promise<T>{
  const headers=new Headers(init.headers);
  headers.set('Content-Type','application/json');
  const access=await getStoredToken('access');
  if(access) headers.set('Authorization',`Bearer ${access}`);
  let res=await fetch(toUrl(path),{...init,headers});
  if(res.status===401&&retry&&(await getStoredToken('refresh'))){
    refreshing??=(refresh().finally(()=>{refreshing=null;}));
    try{
      const token=await refreshing;
      return api<T>(path,{...init,headers:new Headers({...Object.fromEntries(headers),Authorization:`Bearer ${token}`})},{retry:false});
    }catch{
      await logout();
    }
  }
  if(!res.ok){
    const data=await res.json().catch(()=>({}));
    throw new ApiError(data.detail||'Something went wrong',res.status,data);
  }
  return res.status===204?undefined as T:res.json();
}

/** Multipart upload: never sets Content-Type so the browser can add the boundary. */
export async function upload<T>(path:string, form:FormData):Promise<T>{
  const headers=new Headers();
  const access=await getStoredToken('access');
  if(access) headers.set('Authorization',`Bearer ${access}`);
  const res=await fetch(toUrl(path),{method:'POST',headers,body:form});
  if(!res.ok){
    const data=await res.json().catch(()=>({}));
    throw new ApiError(data.detail||firstFieldError(data)||(res.status===413?'The file is too large.':`Upload failed (error ${res.status}).`),res.status,data);
  }
  return res.json();
}

/** DRF field errors look like {photo: ["..."]}: the first message, for display. */
function firstFieldError(data:unknown):string|undefined{if(!data||typeof data!=='object') return undefined; for(const v of Object.values(data as Record<string,unknown>)){const m=Array.isArray(v)?v[0]:v; if(typeof m==='string'&&m) return m;} return undefined;}
/** Fetch a protected image (e.g. a student's ID card photo) as a local object URL. */
export async function fetchProtectedBlobUrl(path:string):Promise<string>{const get=(token:string|null)=>{const headers=new Headers(); if(token) headers.set('Authorization',`Bearer ${token}`); return fetch(toUrl(path),{headers});}; let res=await get(localStorage.getItem('access')); if(res.status===401&&localStorage.getItem('refresh')){try{res=await get(await refresh());}catch{/* session expired */}} if(!res.ok) throw new ApiError(`Photo not available (error ${res.status}).`,res.status,{}); return URL.createObjectURL(await res.blob());}
/** Send a multipart form with any method (upload() is POST only). */
export async function sendForm<T>(path:string, form:FormData|null, method:'POST'|'DELETE'='POST'):Promise<T>{const headers=new Headers(); const access=localStorage.getItem('access'); if(access) headers.set('Authorization',`Bearer ${access}`); const res=await fetch(toUrl(path),{method,headers,body:form??undefined}); if(!res.ok){const data=await res.json().catch(()=>({})); throw new ApiError(data.detail||firstFieldError(data)||(res.status===413?'The file is too large.':`Could not save (error ${res.status}).`),res.status,data);} return res.json();}
/** Stream a protected file with the bearer token attached (no token in the URL). */
export async function download(path:string, filename:string):Promise<void>{
  const headers=new Headers();
  const access=await getStoredToken('access');
  if(access) headers.set('Authorization',`Bearer ${access}`);
  const res=await fetch(toUrl(path),{headers});
  if(!res.ok) throw new Error((await res.json().catch(()=>({}))).detail||'Download failed');
  const blob=await res.blob();
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Signs out: forgets the push token and the login, and wipes what a signed-in parent saved on this device. */
export async function logout():Promise<void>{
  try {
    const { unregisterDeviceToken } = await import('./native/push');
    await unregisterDeviceToken();
  } catch { /* no push on the web */ }
  await clearStoredTokens();
  purgeSavedData();
  try{sessionStorage.clear();}catch{/* storage blocked */}
  window.location.href='/login';
}
export const auth={login:(username:string,password:string)=>api<{access:string;refresh:string;user:User}>('/auth/token/',{method:'POST',body:JSON.stringify({username,password})}),register:(body:unknown)=>api<{access:string;refresh:string;user:User}>('/auth/register/',{method:'POST',body:JSON.stringify(body)}),me:()=>api<User>('/auth/me/'),
  /** Parent sign-in by mobile number: send the code, then verify it. */
  sendOtp:(phone:string)=>api<{detail:string;phone:string;otp_debug?:string}>('/auth/otp/send/',{method:'POST',body:JSON.stringify({phone})}),
  verifyOtp:(phone:string,otp:string)=>api<{access:string;refresh:string;user:User;created:boolean;children_linked:number}>('/auth/otp/verify/',{method:'POST',body:JSON.stringify({phone,otp})}),
};

/** A child on the school roster, as the parent sees it. */
export type ParentChild={id:string;name:string;gr_number:string;grade_name?:string|null;class_name:string;section:string;gender:string;date_of_birth:string|null;school:string;school_name:string;school_code:string;active:boolean};
export const parentChildren={
  list:()=>api<{results:ParentChild[]}>('/students/'),
  /** Fallback when the school's list has no phone for this parent: GR number + date of birth. */
  claim:(school:string,gr_number:string,date_of_birth:string)=>api<ParentChild>('/students/claim/',{method:'POST',body:JSON.stringify({school,gr_number,date_of_birth})}),
  /** Every active school (public list) for the find-your-child form. */
  schools:()=>api<{id:string;name:string;code:string}[]>('/public/schools/'),
};

export type PaymentStartResponse = {
  key_id: string;
  razorpay_order_id: string;
  amount_paise: number;
  currency: 'INR';
  store_order_number: string;
  hold_expires_at: string;
  prefill: { name: string; contact: string };
};

type VerifyPaymentResponse = { payment_view: PaymentView };
type SwitchToCodResponse = { payment_method: 'COD'; payment_view: PaymentView };

export const orderApi = {
  quote: (body: unknown) => api<OrderQuote>('/orders/quote/', { method: 'POST', body: JSON.stringify(body) }),
  payment: (orderId: string) => api<PaymentStartResponse>(`/orders/${orderId}/payment/`, { method: 'POST' }),
  verifyPayment: (orderId: string, data: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
    api<VerifyPaymentResponse>(`/orders/${orderId}/verify-payment/`, { method: 'POST', body: JSON.stringify(data) }),
  reconcilePayment: (orderId: string) => api<PaymentReconcileResponse>(`/orders/${orderId}/reconcile-payment/`, { method: 'POST' }),
  switchToCod: (orderId: string) => api<SwitchToCodResponse>(`/orders/${orderId}/switch-to-cod/`, { method: 'POST' }),
};
export const queryKey={catalog:['catalog'],orders:['orders'],students:['students']};

/** Request a presigned URL to upload a private file directly to object storage. */
export type PhotoPurpose = 'NOTEBOOK' | 'ID_CARD';

export function createPhotoConsent(body: {
  student_id: string;
  purpose: PhotoPurpose;
  keep_for_next_year?: boolean;
}) {
  return api<{
    id: string;
    student_id: string;
    purpose: PhotoPurpose;
    policy_version: string;
    keep_for_next_year: boolean;
  }>('/orders/photo-consent/', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteChildPhotos(studentId: string) {
  return api<{ detail: string; files_removed: number }>('/orders/photo-consent/delete/', {
    method: 'POST',
    body: JSON.stringify({ student_id: studentId }),
  });
}

export async function getUploadPresignedUrl(body: {
  content_type: string;
  file_size: number;
  filename?: string;
  student_id: string;
  purpose: PhotoPurpose;
  /** School staff: confirms the parent agreed on the school's own form. */
  school_consent?: boolean;
}) {
  return api<{
    upload_url: string;
    method: 'POST' | 'PUT';
    fields: Record<string, string>;
    file_key: string;
    expires_in: number;
  }>('/orders/customisation-upload-url/', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Directly upload a blob/file to object storage without touching Django workers. */
export async function uploadDirectToObjectStorage(
  presigned: { upload_url: string; method: 'POST' | 'PUT'; fields?: Record<string, string> },
  fileBlob: Blob,
  contentType: string
) {
  if (presigned.method === 'POST') {
    // S3 form upload
    const formData = new FormData();
    if (presigned.fields) {
      Object.entries(presigned.fields).forEach(([k, v]) => formData.append(k, v));
    }
    formData.append('file', fileBlob);
    const res = await fetch(presigned.upload_url, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(`Direct upload failed with status ${res.status}`);
  } else {
    // S3 PUT or local emulation upload
    const res = await fetch(toUrl(presigned.upload_url), {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: fileBlob,
    });
    if (!res.ok) throw new Error(`Direct upload failed with status ${res.status}`);
  }
}

/* ------------------------------------------------------------------ *
 * School Admin panel
 * ------------------------------------------------------------------ */
export type PanelSchool={id:string;name:string;code:string;city_name:string};
export type Money=string; // decimals come back as strings so nothing rounds twice
export type DashboardTotals={orders:number;units:number;gross_sales:Money;cost?:Money;margin?:Money;average_order_value:Money};
export type CategoryRow={category_id:string;category:string;orders:number;units:number;gross_sales:Money;share_pct:Money};
export type TrendBucket='day'|'week'|'month';
export type DailyPoint={date:string;bucket?:TrendBucket;orders:number;units:number;gross_sales:Money};
export type Commission={rate_set:boolean;rate:string|null;rate_display:string;basis:string;gross_sales:Money;commission_amount:Money|null;currency:string;note:string|null};
export type Dashboard={school:PanelSchool&{commission_rate:string|null};date_from:string;date_to:string;days:number;totals:DashboardTotals;categories:CategoryRow[];daily:DailyPoint[];commission:Commission;pending_students:number;notes:string[]};
export type PanelOrderItem={
  product:string;
  variant:string;
  quantity:number;
  category:string;
  has_customisation?:boolean;
  customisation_summary?:string;
};
export type PanelOrder={id:string;order_number:string;student:string;student_name:string;student_gr:string;student_class:string;student_section:string;items:PanelOrderItem[];item_count:number;units:number;amount:Money;status:string;payment_view: PaymentView; payment_method: 'COD' | 'ONLINE'; needs_reconciliation: boolean; reconciliation_reasons: string[]; payment_status:string;fulfillment_type:string;created_at:string;placed_by:string|null;placed_by_name:string;placed_by_role:string;placed_by_role_label:string};
export type PanelStudent={id:string;name:string;gr_number:string;class_name:string;section:string;gender:string;date_of_birth:string|null;school:string;school_name:string;school_code:string;parent:string|null;parent_name:string;parent_phone:string;approval_status:'PENDING'|'APPROVED';source:string;active:boolean;created_at:string};
export type PanelTeacher={id:string;username:string;email:string;first_name:string;last_name:string;phone:string;role:Role;school:string;school_name:string;is_active:boolean;must_change_password:boolean;created_at:string;temporary_password?:string};
export type ExportJob={id:string;job_type:'ORDERS'|'STUDENTS'|'TAILOR_SHEET';job_type_display:string;status:'QUEUED'|'RUNNING'|'READY'|'FAILED'|'EXPIRED';status_display:string;progress:number;school:string;school_code:string;requested_by_name:string|null;filters:Record<string,string>;filename:string;row_count:number;result:Record<string,unknown>;error_message:string;download_url:string|null;created_at:string;completed_at:string|null;expires_at:string|null};
export type FilterOptions={school:{id:string;name:string;code:string};classes:string[];sections:string[];categories:{id:string;name:string}[];statuses:{value:string;label:string}[];placed_by_roles:{value:string;label:string}[];default_date_from:string;default_date_to:string};
export type ImportJob={id:string;job_type:string;status:'PENDING'|'VALIDATING'|'PREVIEW_READY'|'IMPORTING'|'COMPLETED'|'FAILED';school:string;school_code:string|null;uploaded_by_name:string|null;original_filename:string;total_rows:number;valid_count:number;duplicate_count:number;error_count:number;preview:Record<string,unknown>;result:Record<string,unknown>;error_message:string;progress:number;created_at:string;completed_at:string|null};
export type Page<T>={next:string|null;previous:string|null;results:T[]};
/**
 * Read every page of a staff list. The server pages with a `next` link (a cursor),
 * so follow that link's cursor until there is none. Stops after `maxPages` as a guard.
 */
export async function allPages<T>(fetchPage:(params:Record<string,string>)=>Promise<Page<T>>, params:Record<string,string>, maxPages=50):Promise<Page<T>>{
  const results:T[]=[]; const seen=new Set<string>(); let extra:Record<string,string>={};
  for(let i=0;i<maxPages;i+=1){
    const data=await fetchPage({...params,...extra}); results.push(...data.results);
    if(!data.next) break;
    const next=new URL(data.next, window.location.origin).searchParams;
    const cursor=next.get('cursor'); const page=next.get('page');
    const key=cursor?`c:${cursor}`:page?`p:${page}`:'';
    if(!key||seen.has(key)) break; seen.add(key);
    extra=cursor?{cursor}:{page:page as string};
  }
  return {results,next:null,previous:null};
}
export type StudentOrders={student:{id:string;name:string;gr_number:string;class_name:string;section:string};date_from:string;date_to:string;totals:{orders:number;units:number;gross_sales:Money};item_preview_limit:number;next:string|null;previous:string|null;results:PanelOrder[]};

/** Cursor links come back as absolute URLs; keep only the path + query. */
export function relative(url:string|null):string|null{
  if(!url) return null;
  try{
    const u=new URL(url, window.location.origin);
    return `${u.pathname}${u.search}`;
  }catch{ return null; }
}
export const panel={
  schools:()=>api<{results:PanelSchool[]}>('/panel/schools/'),
  filters:(school:string)=>api<FilterOptions>(`/panel/filters/?school=${school}`),
  dashboard:(school:string,from:string,to:string)=>api<Dashboard>(`/panel/dashboard/?school=${school}&date_from=${from}&date_to=${to}`),
  teacherSummary:()=>api<TeacherSummary>('/panel/teacher-summary/'),
  orders:(school:string,p:Record<string,string>={})=>api<Page<PanelOrder>>(`/panel/orders/?${new URLSearchParams({school,...p})}`),
  students:(school:string,p:Record<string,string>={})=>api<Page<PanelStudent>>(`/panel/students/?${new URLSearchParams({school,...p})}`),
  pendingStudents:(school:string)=>api<{count:number;results:PanelStudent[]}>(`/panel/students/pending/?school=${school}`),
  addStudent:(school:string,body:Record<string,unknown>)=>api<PanelStudent>(`/panel/students/?school=${school}`,{method:'POST',body:JSON.stringify(body)}),
  editStudent:(school:string,id:string,body:Record<string,unknown>)=>api<PanelStudent>(`/panel/students/${id}/?school=${school}`,{method:'PATCH',body:JSON.stringify(body)}),
  approveStudent:(school:string,id:string,body:Record<string,unknown>={})=>api<PanelStudent>(`/panel/students/${id}/approve/?school=${school}`,{method:'POST',body:JSON.stringify(body)}),
  studentOrders:(school:string,id:string,p:Record<string,string>={})=>api<StudentOrders>(`/panel/students/${id}/orders/?${new URLSearchParams({school,...p})}`),
  teachers:(school:string)=>api<Page<PanelTeacher>>(`/panel/teachers/?school=${school}`),
  addTeacher:(school:string,body:Record<string,unknown>)=>api<PanelTeacher>(`/panel/teachers/?school=${school}`,{method:'POST',body:JSON.stringify(body)}),
  editTeacher:(school:string,id:string,body:Record<string,unknown>)=>api<PanelTeacher>(`/panel/teachers/${id}/?school=${school}`,{method:'PATCH',body:JSON.stringify(body)}),
  setTeacherActive:(school:string,id:string,active:boolean)=>api<PanelTeacher>(`/panel/teachers/${id}/${active?'activate':'deactivate'}/?school=${school}`,{method:'POST'}),
  exports:(school:string)=>api<Page<ExportJob>>(`/panel/exports/?school=${school}`),
  exportJob:(school:string,id:string)=>api<ExportJob>(`/panel/exports/${id}/?school=${school}`),
  requestExport:(school:string,job_type:'ORDERS'|'STUDENTS',filters:Record<string,string>)=>api<ExportJob>(`/panel/exports/?school=${school}`,{method:'POST',body:JSON.stringify({job_type,filters})}),
  deleteExport:(school:string,id:string)=>api<void>(`/panel/exports/${id}/?school=${school}`,{method:'DELETE'}),
  importJobs:(school:string)=>api<Page<ImportJob>>(`/panel/student-imports/?school=${school}`),
  importJob:(school:string,id:string)=>api<ImportJob>(`/panel/student-imports/${id}/?school=${school}`),
  uploadImport:(school:string,file:File)=>{const f=new FormData(); f.append('file',file); return upload<ImportJob>(`/panel/student-imports/?school=${school}`,f);},
  confirmImport:(school:string,id:string,markMissingAsLeft=false)=>api<ImportJob>(`/panel/student-imports/${id}/confirm/?school=${school}`,{method:'POST',body:JSON.stringify({mark_missing_as_left:markMissingAsLeft})}),
  importReportUrl:(school:string,id:string)=>`/panel/student-imports/${id}/report/?school=${school}`,
  importTemplateUrl:(school:string,fmt:'xlsx'|'csv')=>`/panel/student-imports/template/?school=${school}&format=${fmt}`,
};

/** Size chart import. `scope` is a school id, or 'generic' (Boss only) for items every school shares. */
export type SizeChartPreview={
  products?:{product_id:string;product_name:string;adds:number;replaces:number;unchanged:number;deletes:string[]}[];
  rejected?:{product_id:string;product_name:string;reasons:string[];missing_skus:string[];row_errors:{row:number;sku:string;errors:Record<string,string>}[]}[];
  errors?:{row:number;sku:string;errors:Record<string,string>}[];
  summary?:{products_accepted:number;products_rejected:number;adds:number;replaces:number;unchanged:number;deletes:number;unknown_rows:number};
};
export const sizeCharts={
  job:(scope:string,id:string)=>api<ImportJob>(`/size-chart-imports/${id}/?school=${scope}`),
  upload:(scope:string,file:File)=>{const f=new FormData(); f.append('file',file); return upload<ImportJob>(`/size-chart-imports/?school=${scope}`,f);},
  confirm:(scope:string,id:string)=>api<ImportJob>(`/size-chart-imports/${id}/confirm/?school=${scope}`,{method:'POST'}),
  reportUrl:(scope:string,id:string)=>`/size-chart-imports/${id}/report/?school=${scope}`,
  templateUrl:(scope:string)=>`/size-chart-imports/template/?school=${scope}`,
  charts:(scope:string,page=1)=>api<Page<SizeChartItem>&{count:number}>(`/size-charts/?school=${scope}&page=${page}`),
  addRow:(body:Partial<SizeChartValues>&{variant:string})=>api<SizeChartRowData>('/size-charts/rows/',{method:'POST',body:JSON.stringify(body)}),
  editRow:(id:string,body:Partial<SizeChartValues>)=>api<SizeChartRowData>(`/size-charts/rows/${id}/`,{method:'PATCH',body:JSON.stringify(body)}),
  removeRow:(id:string)=>api<void>(`/size-charts/rows/${id}/`,{method:'DELETE'}),
  removeChart:(scope:string,productId:string)=>api<{rows_removed:number}>(`/size-charts/${productId}/?school=${scope}`,{method:'DELETE'}),
  copy:(scope:string,source:string,targets:string[])=>api<{products:{product_id:string;product_name:string;rows_written:number;sizes_not_in_source:string[]}[]}>(`/size-charts/copy/?school=${scope}`,{method:'POST',body:JSON.stringify({source_product:source,target_products:targets})}),
};

/** Tailor sheet (Admin and Boss): built by the export worker, then downloaded. */
export type TailorFilters={schools?:string[];grade?:string;date_from?:string;date_to?:string;statuses?:string[];order?:string};
export const tailorSheets={
  create:(filters:TailorFilters)=>api<ExportJob>('/panel/tailor-sheets/',{method:'POST',body:JSON.stringify({filters})}),
  job:(id:string)=>api<ExportJob>(`/panel/tailor-sheets/${id}/`),
};

export const SIZE_CHART_COLUMNS=['height_cm_min','height_cm_max','weight_kg_min','weight_kg_max','shoulder_cm_min','shoulder_cm_max','chest_cm_min','chest_cm_max','length_cm'] as const;
export type SizeChartValues=Record<typeof SIZE_CHART_COLUMNS[number],number|null>;
export type SizeChartRowData=SizeChartValues&{id:string|null;variant:string;sku:string;size:string};
export type SizeChartItem={product_id:string;product_name:string;category:string;has_chart:boolean;rows:SizeChartRowData[]};

/* ------------------------------------------------------------------ *
 * City Admin panel (scoped to city)
 * ------------------------------------------------------------------ */
export type TeacherSummary={
  school:{id:string;name:string;code:string};
  students:{total:number;pending:number};
  month:{date_from:string;date_to:string;orders:number;units:number;gross_sales:Money};
  today:{orders:number;gross_sales:Money};
  trend:{date:string;orders:number;gross_sales:Money}[];
};

export type CityDailySales={
  date:string;
  trend:{date:string;orders:number;units:number;revenue:Money}[];
  city:{id:string;name:string;code:string};
  totals:{orders:number;units:number;revenue:Money};
  categories:{category_id:string;category_name:string;orders:number;units:number;revenue:Money}[];
  schools:{school_id:string;school_name:string;school_code:string;orders:number;units:number;revenue:Money}[];
};

export type StockBalance={
  id:string;
  city:string;
  variant:string;
  variant_sku:string;
  product_name:string;
  product_category?:string;
  product_type?:string|null;
  variant_size?:string;
  stock_quantity:number;
  low_stock_threshold:number;
  is_low_stock:boolean;
  updated_at:string;
};

export type StockMovement={
  id:string;
  city:string;
  school:string|null;
  variant:string;
  variant_sku:string;
  quantity_change:number;
  reason:string;
  reference_order:string|null;
  created_by:string|null;
  created_at:string;
};

export type CitySchool={
  id:string;
  city:string;
  city_name:string;
  name:string;
  code:string;
  active:boolean;
  commission_rate:string|null;
  home_delivery_enabled:boolean;
  school_pickup_enabled:boolean;
  address:string;
  contact_email:string;
  contact_phone:string;
  logo_url?:string|null;
  show_logo_public?:boolean;
  /** Classes the school has ("Nursery", "Class 1", ...). Empty: every class. */
  grades?:string[];
  created_at:string;
};

export type CityOrderDetail={
  id:string;
  order_number:string;
  placed_by:string|null;
  placed_by_role:string;
  payer:string|null;
  student:string;
  student_name:string;
  student_gr:string;
  parent:string|null;
  school:string;
  school_name:string;
  school_code:string;
  city:string;
  city_name:string;
  status:string;
  payment_view: PaymentView;
  payment_method: 'COD' | 'ONLINE';
  payment_status:string;
  fulfillment_type:string;
  subtotal:Money;
  total:Money;
  delivery_details:Record<string,any>;
  items:{
    id:string;
    measurement?:{height_cm:number;weight_kg:number;shoulder_cm:number|null;source:string;shoulder_edited:boolean;recommended_size:string;recommendation_status:string;chosen_size:string}|null;
    variant:string;
    variant_sku:string;
    variant_size:string;
    product_name:string;
    category:string;
    quantity:number;
    unit_price_snapshot:Money;
    customisation_data:Record<string,any>;
    customisation_display?:Record<string, {
      type: string;
      value?: any;
      file_key?: string;
      url?: string;
      full_url?: string;
      original_url?: string;
      status?: string;
    }>;
  }[];
  status_events:{
    id:string;
    status:string;
    timestamp:string;
    changed_by:string|null;
    note:string;
  }[];
  created_at:string;
  updated_at:string;
};

export const cityAdmin={
  dailySales:(date?:string,city?:string)=>api<CityDailySales>(`/panel/city-daily-sales/?${new URLSearchParams({...(date?{date}:{}),...(city?{city}:{})})}`),
  stockBalances:(p:Record<string,string>={})=>api<Page<StockBalance>>(`/stock-balances/?${new URLSearchParams(p)}`),
  lowStock:(p:Record<string,string>={})=>api<Page<StockBalance>>(`/stock-balances/low/?${new URLSearchParams(p)}`),
  stockMovements:(variantId?:string,p:Record<string,string>={})=>api<Page<StockMovement>>(`/stock-movements/?${new URLSearchParams({...(variantId?{variant:variantId}:{}),...p})}`),
  addStockMovement:(body:{variant:string;quantity_change:number;reason:string;city?:string;reference_order?:string|null})=>api<StockMovement>('/stock-movements/',{method:'POST',body:JSON.stringify(body)}),
  orders:(p:Record<string,string>={})=>api<Page<CityOrderDetail>>(`/orders/?${new URLSearchParams(p)}`),
  orderDetail:(id:string)=>api<CityOrderDetail>(`/orders/${id}/`),
  updateOrderStatus:(id:string,status:string)=>api<CityOrderDetail>(`/orders/${id}/`,{method:'PATCH',body:JSON.stringify({status})}),
  bulkStatus:(order_ids:string[],status:string,note?:string)=>api<{updated_count:number;status:string;order_ids:string[]}>('/orders/bulk-status/',{method:'POST',body:JSON.stringify({order_ids,status,note})}),
  schools:(p:Record<string,string>={})=>api<Page<CitySchool>>(`/schools/?${new URLSearchParams(p)}`),
  addSchool:(body:Partial<CitySchool>)=>api<CitySchool>('/schools/',{method:'POST',body:JSON.stringify(body)}),
  updateSchool:(id:string,body:Partial<CitySchool>)=>api<CitySchool>(`/schools/${id}/`,{method:'PATCH',body:JSON.stringify(body)}),
  users:(p:Record<string,string>={})=>api<Page<User>>(`/accounts/users/?${new URLSearchParams(p)}`),
  createSchoolAdmin:(body:{username:string;password:string;school:string;email?:string;first_name?:string;last_name?:string;phone?:string})=>api<User>('/accounts/users/',{method:'POST',body:JSON.stringify(body)}),
  resetPassword:(userId:string,password:string)=>api<{detail:string}>(`/accounts/users/${userId}/reset-password/`,{method:'POST',body:JSON.stringify({password})}),
  fulfilmentQueue:(p:Record<string,string>={})=>api<Page<FulfilmentQueueOrder>>(`/fulfilment/queue/?${new URLSearchParams(p)}`),
  packingList:(id:string)=>api<PackingListResponse>(`/fulfilment/${id}/packing-list/`),
  claimOrder:(id:string)=>api<ClaimResult>(`/fulfilment/${id}/claim/`,{method:'POST'}),
  releaseClaim:(id:string)=>api<ReleaseResult>(`/fulfilment/${id}/release/`,{method:'POST'}),
  reportIssue:(id:string,note:string)=>api<IssueResult>(`/fulfilment/${id}/issue/`,{method:'POST',body:JSON.stringify({note})}),
  clearIssue:(id:string)=>api<ClearIssueResult>(`/fulfilment/${id}/issue/clear/`,{method:'POST'}),
  packOrder:(id:string,confirmed_item_ids:string[],note?:string)=>api<PackSingleResult>(`/fulfilment/${id}/pack/`,{method:'POST',body:JSON.stringify({confirmed_item_ids,note})}),
  dispatch:(id:string,article_number:string,receipt_confirmed:boolean,booked_at?:string)=>api<FulfilmentDispatchResult>(`/fulfilment/${id}/dispatch/`,{method:'POST',body:JSON.stringify({article_number,receipt_confirmed,booked_at})}),
  correctArticleNumber:(id:string,article_number:string,reason?:string)=>api<CorrectArticleNumberResult>(`/fulfilment/${id}/correct-article-number/`,{method:'POST',body:JSON.stringify({article_number,reason})}),
  readyForPickup:(order_ids:string[])=>api<FulfilmentActionBatchResult>('/fulfilment/ready-for-pickup/',{method:'POST',body:JSON.stringify({order_ids})}),
  markDelivered:(order_ids:string[])=>api<FulfilmentActionBatchResult>('/fulfilment/delivered/',{method:'POST',body:JSON.stringify({order_ids})}),
};

export type FulfilmentQueueOrder = {
  id: string;
  order_number: string;
  school_name: string;
  school_code: string;
  student_name: string;
  student_gr: string;
  fulfillment_type: 'HOME_DELIVERY' | 'SCHOOL_PICKUP';
  payment_status: string;
  payment_method: string;
  status: string;
  items_count: number;
  total: Money;
  created_at: string;
  can_pack: boolean | null;
  blocked_reason: string | null;
  blocked_message: string | null;
  claimed_by_name: string | null;
  claimed_by_me: boolean;
  claimed_at: string | null;
  packed_by_name: string | null;
  packed_at: string | null;
  issue_note: string;
  consignment_number: string | null;
  dispatched_at: string | null;
};

export type PackingListItem = {
  id: string;
  product_name: string;
  sku: string;
  size: string;
  quantity: number;
  multiple: boolean;
  personalisation: Record<string, unknown>;
};

export type PackingListResponse = {
  order_id: string;
  order_number: string;
  status: string;
  is_claimed_by_me: boolean;
  claimed_by_name: string | null;
  issue_note: string;
  lines: PackingListItem[];
};

export type ClaimResult = {
  changed: boolean;
  order_id: string;
  claimed_by: string;
  claimed_by_name: string;
  claimed_at: string;
};

export type ReleaseResult = {
  released: boolean;
  order_id: string;
};

export type IssueResult = {
  issue_reported: boolean;
  order_id: string;
  note: string;
};

export type ClearIssueResult = {
  issue_cleared: boolean;
  order_id: string;
};

export type PackSingleResult = {
  changed: boolean;
  order_id: string;
};

export type CorrectArticleNumberResult = {
  changed: boolean;
  order_id: string;
  consignment_number: string;
};

export type FulfilmentPackResult = {
  packed_ids: string[];
  blocked: { order_id: string; reason: string; message: string }[];
  skipped_ids?: string[];
};

export type FulfilmentDispatchResult = {
  order_id: string;
  consignment_number: string;
  carrier: string;
  booked_at: string;
};

export type FulfilmentActionBatchResult = {
  updated_ids: string[];
  skipped_ids?: string[];
};

/* ------------------------------------------------------------------ *
 * Boss Executive Panel
 * ------------------------------------------------------------------ */
export type BossKpis={
  date_from:string;
  date_to:string;
  revenue:Money;
  cost:Money;
  gross_profit:Money;
  gross_margin_pct:string;
  orders:number;
  units_sold:number;
  average_order_value:Money;
  current_stock_value:Money;
  previous:{date_from:string;date_to:string;revenue:Money;gross_profit:Money;orders:number;units:number};
};

export type BossRevProfitPoint={
  date:string;
  bucket:TrendBucket;
  revenue:Money;
  cost:Money;
  profit:Money;
  orders:number;
  units:number;
};

export type BossCategoryPoint={
  category_id:string;
  name:string;
  revenue:Money;
  cost:Money;
  profit:Money;
  units:number;
  orders:number;
};

export type BossCityPoint={
  city_id:string;
  name:string;
  code:string;
  revenue:Money;
  cost:Money;
  profit:Money;
  units:number;
  orders:number;
};

export type BossSchoolPoint={
  school_id:string;
  name:string;
  code:string;
  revenue:Money;
  cost:Money;
  profit:Money;
  units:number;
  orders:number;
};

export type BossProductPoint={
  product_id:string;
  name:string;
  category:string;
  units:number;
  revenue:Money;
  profit:Money;
};

export type BossStockCatPoint={
  category_id:string;
  name:string;
  units:number;
  stock_value:Money;
};

export type BossFilterOptions={
  cities:{id:string;name:string;code:string}[];
  schools:{id:string;name:string;code:string;city_id:string}[];
  categories:{id:string;name:string;slug:string}[];
  default_from:string;
  default_to:string;
};

export const bossPanel={
  filters:()=>api<BossFilterOptions>('/panel/boss/filters/'),
  kpis:(p:Record<string,string>={})=>api<BossKpis>(`/panel/boss/kpis/?${new URLSearchParams(p)}`),
  revenueProfit:(p:Record<string,string>={})=>api<BossRevProfitPoint[]>(`/panel/boss/charts/revenue-profit/?${new URLSearchParams(p)}`),
  categories:(p:Record<string,string>={})=>api<BossCategoryPoint[]>(`/panel/boss/charts/categories/?${new URLSearchParams(p)}`),
  cities:(p:Record<string,string>={})=>api<BossCityPoint[]>(`/panel/boss/charts/cities/?${new URLSearchParams(p)}`),
  topSchools:(p:Record<string,string>={})=>api<BossSchoolPoint[]>(`/panel/boss/charts/top-schools/?${new URLSearchParams(p)}`),
  topProducts:(p:Record<string,string>={})=>api<BossProductPoint[]>(`/panel/boss/charts/top-products/?${new URLSearchParams(p)}`),
  stockCategories:(p:Record<string,string>={})=>api<BossStockCatPoint[]>(`/panel/boss/charts/stock-categories/?${new URLSearchParams(p)}`),
  // Boss management operations
  citiesList:()=>api<Page<{id:string;name:string;code:string;state:string;active:boolean}>>('/cities/'),
  createCity:(body:{name:string;code:string;state:string})=>api<{id:string;name:string;code:string}>('/cities/',{method:'POST',body:JSON.stringify(body)}),
  updateCity:(id:string,body:Partial<{name:string;code:string;state:string;active:boolean}>)=>api<any>(`/cities/${id}/`,{method:'PATCH',body:JSON.stringify(body)}),
  createAdmin:(body:{username:string;password:string;city:string;email?:string;first_name?:string;last_name?:string;phone?:string})=>api<User>('/accounts/users/',{method:'POST',body:JSON.stringify({role:'ADMIN',...body})}),
  adminsList:()=>api<Page<User>>('/accounts/users/?role=ADMIN'),
  updateSchoolCommission:(schoolId:string,commission_rate:string|null)=>api<CitySchool>(`/schools/${schoolId}/`,{method:'PATCH',body:JSON.stringify({commission_rate})}),
};
export const money=(v:Money|number|null|undefined)=>{
  if(v===null||v===undefined) return '-';
  const n=typeof v==='number'?v:Number(v);
  if(Number.isNaN(n)) return String(v);
  return '₹'+n.toLocaleString('en-IN',{maximumFractionDigits:0});
};
export const money2=(v:Money|number|null|undefined)=>{
  if(v===null||v===undefined) return '-';
  const n=typeof v==='number'?v:Number(v);
  if(Number.isNaN(n)) return String(v);
  return '₹'+n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
};
export const num=(v:Money|number|null|undefined)=>v===null||v===undefined?'-':Number(v).toLocaleString('en-IN');

/* ------------------------------------------------------------------ *
 * Retail shops and their school requests
 * ------------------------------------------------------------------ */
export type SchoolBoard='CBSE'|'ICSE'|'GSEB'|'OTHER';
export const SCHOOL_BOARDS:{value:SchoolBoard;label:string}[]=[
  {value:'CBSE',label:'CBSE'},
  {value:'ICSE',label:'ICSE'},
  {value:'GSEB',label:'GSEB (Gujarat Board)'},
  {value:'OTHER',label:'Other'},
];
export type RequestStatus='PENDING'|'APPROVED'|'REJECTED';
export type RetailStore={
  id:string;name:string;address:string;phone:string;gst_number:string;
  city:string;city_name:string;username:string;owner_name:string;
  schools:{id:string;name:string;udise_code:string|null;active:boolean}[];
  active:boolean;created_at:string;
};
export type SchoolRequest={
  id:string;store:string;store_name:string;name:string;udise_code:string;address:string;
  city:string;city_name:string;board:SchoolBoard;board_label:string;pincode:string;
  status:RequestStatus;school:string|null;school_name:string|null;reviewed_by_name:string|null;
  reviewed_at:string|null;reject_reason:string;
  /** Pending only: the school with this UDISE code already on the store. */
  existing_school:{id:string;name:string;has_logo:boolean}|null;
  created_at:string;
};
export type NewRetailer={
  username:string;password:string;first_name?:string;last_name?:string;email?:string;
  store_name:string;address:string;phone:string;gst_number?:string;city:string;
};

export const retail={
  myStore:()=>api<RetailStore>('/retail/my-store/'),
  cities:()=>api<{id:string;name:string}[]>('/retail/cities/'),
  requests:(status?:RequestStatus)=>api<Page<SchoolRequest>>(`/retail/school-requests/${status?`?status=${status}`:''}`),
  /** Multipart: name, udise_code, address, city, board, pincode, logo. */
  sendRequest:(form:FormData)=>upload<SchoolRequest>('/retail/school-requests/',form),
  approve:(id:string,body:{school?:string|null;use_new_logo:boolean})=>api<SchoolRequest>(`/retail/school-requests/${id}/approve/`,{method:'POST',body:JSON.stringify(body)}),
  reject:(id:string,reason:string)=>api<SchoolRequest>(`/retail/school-requests/${id}/reject/`,{method:'POST',body:JSON.stringify({reason})}),
  retailers:()=>api<Page<RetailStore>>('/retail/retailers/'),
  createRetailer:(body:NewRetailer)=>api<RetailStore>('/retail/retailers/',{method:'POST',body:JSON.stringify(body)}),
  requestLogoPath:(id:string)=>`/retail/school-requests/${id}/logo/`,
  uniforms:()=>api<Page<UniformSet>>('/retail/uniforms/'),
  uniform:(id:string)=>api<UniformSet>(`/retail/uniforms/${id}/`),
  addUniform:(body:{school:string;gender:UniformGender;classes:number[];name:string;price:number})=>api<UniformSet>('/retail/uniforms/',{method:'POST',body:JSON.stringify(body)}),
  /** Multipart: photo (the cloth), description, sizes (comma list). Clears any earlier mock-ups. */
  uniformDetails:(id:string,form:FormData)=>upload<UniformSet>(`/retail/uniforms/${id}/details/`,form),
  uniformAction:(id:string,action:'accept-all'|'publish'|'unpublish'|'hide')=>api<UniformSet>(`/retail/uniforms/${id}/${action}/`,{method:'POST'}),
  reviewMockup:(id:string,classNo:number,how:'accept'|'reject')=>api<UniformSet>(`/retail/uniforms/${id}/mockups/${classNo}/${how}/`,{method:'POST'}),
  /** The picture the browser's mock-up engine made for one class. */
  saveMockup:(id:string,classNo:number,picture:Blob)=>api<UniformSet>(`/retail/uniforms/${id}/mockups/${classNo}/image/`,{method:'POST',body:picture}),
  /** Includes the set's version: a changed photo must not come from the browser's cache. */
  clothPhotoPath:(set:UniformSet)=>`/retail/uniforms/${set.id}/photo/bottom/?v=${encodeURIComponent(set.updated_at)}`,
};

export type UniformGender='BOY'|'GIRL';
export type Mockup={id:string;class_no:number;status:'DONE';review:'PENDING'|'ACCEPTED'|'REJECTED';error:string;
  /** Site path of the finished picture (only when DONE). */
  image:string|null};
export type UniformSet={
  id:string;store:string;store_name:string;school:string;school_name:string;gender:UniformGender;
  class_from:number;class_to:number;classes:number[];description:string;has_photo:boolean;updated_at:string;name:string;price:number;sizes:string[];
  status:'DRAFT'|'LIVE'|'HIDDEN';mockups:Mockup[];mockups_done:number;mockups_total:number;created_at:string;
};
/** A mock-up picture's address in this app (the API gives a site path). */
export const mockupUrl=(path:string)=>toUrl(path);

/** The school's public logo (cached by the browser for a day). */
export const schoolLogoUrl=(schoolId:string)=>toUrl(`/public/schools/${schoolId}/logo/`);

/** A signed-in file (e.g. a pending request's logo) as an object URL an <img> can show. */
export async function fetchBlobUrl(path:string):Promise<string>{const headers=new Headers(); const access=await getStoredToken('access'); if(access) headers.set('Authorization',`Bearer ${access}`); const res=await fetch(toUrl(path),{headers}); if(!res.ok) throw new ApiError('Could not load the picture',res.status); return URL.createObjectURL(await res.blob());}

/** Field errors from a 400 response, joined per field, for showing under each input. */
export function fieldErrors(err:unknown):Record<string,string>{
  if(!(err instanceof ApiError)) return {};
  const out:Record<string,string>={};
  for(const [key,value] of Object.entries(err.data)){
    if(key==='detail') continue;
    out[key]=Array.isArray(value)?value.join(' '):String(value);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Uniform Portal (Schools, Uniforms, Stock)
 * ------------------------------------------------------------------ */
export type PortalVariant = {
  id: string;
  product: string;
  product_name?: string;
  category_name?: string;
  school?: string | null;
  city?: string | null;
  size: string;
  sku: string;
  active: boolean;
  created_at: string;
};

export type PortalProduct = {
  id: string;
  category: string;
  category_name?: string;
  school: string | null;
  school_name?: string | null;
  city?: string | null;
  name: string;
  description: string;
  images: string[];
  thumbnail?: string | null;
  cost_price?: string | number;
  selling_price: string | number;
  gender: 'boy' | 'girl' | 'unisex';
  product_type?: 'SOCKS' | 'BELT' | 'TIE' | string | null;
  needs_review?: boolean;
  grades?: string[];
  class_from?: number | null;
  class_to?: number | null;
  customisation_schema?: any;
  active: boolean;
  variants: PortalVariant[];
  created_at: string;
};

export type PortalCategory = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  display_order: number;
  active: boolean;
};

export type PortalCity = {
  id: string;
  name: string;
  code: string;
  state: string;
  active: boolean;
};

export type ProductCityPrice = {
  id: string;
  product: string;
  product_name: string;
  product_images: string[];
  school_name: string;
  universal_selling_price: string;
  universal_cost_price?: string;
  city: string;
  city_name: string;
  selling_price: string;
  cost_price?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export const portalApi = {
  schools: (p: Record<string, string> = {}) => api<Page<CitySchool>>(`/schools/?${new URLSearchParams(p)}`),
  addSchool: (body: Partial<CitySchool>) => api<CitySchool>('/schools/', { method: 'POST', body: JSON.stringify(body) }),
  updateSchool: (id: string, body: Partial<CitySchool>) => api<CitySchool>(`/schools/${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSchool: (id: string) => api<CitySchool>(`/schools/${id}/`, { method: 'PATCH', body: JSON.stringify({ active: false }) }),
  cities: (p: Record<string, string> = {}) => api<Page<PortalCity>>(`/cities/?${new URLSearchParams({ page_size: '50', ...p })}`),
  products: (p: Record<string, string> = {}) => api<Page<PortalProduct>>(`/products/?${new URLSearchParams(p)}`),
  createProduct: (body: any) => api<PortalProduct>('/products/', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: string, body: any) => api<PortalProduct>(`/products/${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProduct: (id: string) => api<void>(`/products/${id}/?permanent=true`, { method: 'DELETE' }),
  uploadProductPhoto: (productId: string, file: File) => {
    const fd = new FormData();
    fd.append('photo', file);
    return upload<PortalProduct>(`/products/${productId}/photo/`, fd);
  },
  variants: (p: Record<string, string> = {}) => api<Page<PortalVariant>>(`/variants/?${new URLSearchParams(p)}`),
  createVariant: (body: { product: string; size: string; sku: string; active?: boolean }) =>
    api<PortalVariant>('/variants/', { method: 'POST', body: JSON.stringify(body) }),
  updateVariant: (id: string, body: { size?: string; sku?: string; active?: boolean }) =>
    api<PortalVariant>(`/variants/${id}/`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteVariant: (id: string) => api<void>(`/variants/${id}/`, { method: 'DELETE' }),
  categories: () => api<Page<PortalCategory>>('/categories/?page_size=50'),
  stockBalances: (p: Record<string, string> = {}) => api<Page<StockBalance>>(`/stock-balances/?${new URLSearchParams(p)}`),
  receiveIndiaStock: (variants: string[], quantityPerSize: number) =>
    api<StockMovement[]>('/stock-movements/bulk-receipt/', {
      method: 'POST',
      body: JSON.stringify({ variants, quantity_per_size: quantityPerSize }),
    }),
  addStockMovement: (body: { variant: string; quantity_change: number; reason: string; city?: string; scope?: 'india' }) =>
    api<StockMovement>('/stock-movements/', { method: 'POST', body: JSON.stringify(body) }),
  cityPrices: (p: Record<string, string> = {}) => api<Page<ProductCityPrice>>(`/city-prices/?${new URLSearchParams(p)}`),
  setCityPrice: (body: { product: string; city: string; selling_price: string; cost_price?: string }) =>
    api<ProductCityPrice>('/city-prices/', { method: 'POST', body: JSON.stringify(body) }),
  deleteCityPrice: (id: string) => api<void>(`/city-prices/${id}/`, { method: 'DELETE' }),
  branches: (p: Record<string, string> = {}) =>
    api<Page<{ id: string; school: string; school_name: string; city: string; city_name: string; city_state: string; name: string; display_name: string; address: string; pincode: string; phone: string; active: boolean }>>(
      `/branches/?${new URLSearchParams({ page_size: '50', ...p })}`
    ),
};

export const teacherAdmin = {
  list: (p: Record<string, string> = {}) =>
    api<Page<User>>(`/auth/users/?${new URLSearchParams({ role: 'TEACHER', page_size: '50', ...p })}`),
  create: (body: {
    first_name: string;
    last_name?: string;
    phone?: string;
    school?: string | null;
    branch?: string | null;
    city?: string | null;
    all_schools_access?: boolean;
  }) => api<User>('/auth/users/create-teacher/', { method: 'POST', body: JSON.stringify(body) }),
  regeneratePassword: (id: string) =>
    api<{ id: string; username: string; issued_password: string }>(`/auth/users/${id}/regenerate-password/`, {
      method: 'POST',
    }),
  toggleActive: (id: string, is_active: boolean) =>
    api<User>(`/auth/users/${id}/`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
};
