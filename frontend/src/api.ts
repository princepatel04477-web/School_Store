export type Role='PARENT'|'TEACHER'|'SCHOOL_ADMIN'|'ADMIN'|'BOSS';
export type User={id:string;username:string;role:Role;school?:{name:string};phone?:string};
export type StockStatus='IN_STOCK'|'LOW_STOCK'|'OUT_OF_STOCK';
export type Product={id:string;name:string;category:string;price:number;image?:string;thumbnail?:string|null;variants:{id:string;size:string;stock_status:StockStatus|null}[]};
export type Order={id:string;order_number:string;student_name:string;status:string;payment_status:string;total:number;created_at:string;status_events?:{status:string;timestamp:string}[]};
const API=import.meta.env.VITE_API_URL||'/api';
let refreshing:Promise<string>|null=null;
async function refresh(){const token=localStorage.getItem('refresh'); const r=await fetch(`${API}/auth/token/refresh/`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh:token})}); if(!r.ok) throw Error('session expired'); const d=await r.json(); localStorage.setItem('access',d.access); return d.access;}
/** Turns an API path into a full URL. Paths may be "/panel/..." or "/api/panel/...". */
function toUrl(path:string){return path.startsWith('/api/')?`${API}${path.slice(4)}`:`${API}${path}`;}
export async function api<T>(path:string, init:RequestInit={},{retry=true}={}):Promise<T>{const headers=new Headers(init.headers); headers.set('Content-Type','application/json'); const access=localStorage.getItem('access'); if(access) headers.set('Authorization',`Bearer ${access}`); let res=await fetch(toUrl(path),{...init,headers}); if(res.status===401&&retry&&localStorage.getItem('refresh')){refreshing??=(refresh().finally(()=>{refreshing=null})); try{const token=await refreshing; return api<T>(path,{...init,headers:new Headers({...Object.fromEntries(headers),Authorization:`Bearer ${token}`})},{retry:false})}catch{logout();}} if(!res.ok) throw new Error((await res.json().catch(()=>({}))).detail||'Something went wrong'); return res.status===204?undefined as T:res.json();}
/** Multipart upload: never sets Content-Type so the browser can add the boundary. */
export async function upload<T>(path:string, form:FormData):Promise<T>{const headers=new Headers(); const access=localStorage.getItem('access'); if(access) headers.set('Authorization',`Bearer ${access}`); const res=await fetch(toUrl(path),{method:'POST',headers,body:form}); if(!res.ok) throw new Error((await res.json().catch(()=>({}))).detail||'Upload failed'); return res.json();}
/** Stream a protected file with the bearer token attached (no token in the URL). */
export async function download(path:string, filename:string){const headers=new Headers(); const access=localStorage.getItem('access'); if(access) headers.set('Authorization',`Bearer ${access}`); const res=await fetch(toUrl(path),{headers}); if(!res.ok) throw new Error((await res.json().catch(()=>({}))).detail||'Download failed'); const blob=await res.blob(); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);}
export function logout(){localStorage.removeItem('access');localStorage.removeItem('refresh'); window.location.href='/login';}
export const auth={login:(username:string,password:string)=>api<{access:string;refresh:string;user:User}>('/auth/token/',{method:'POST',body:JSON.stringify({username,password})}),register:(body:unknown)=>api<{access:string;refresh:string;user:User}>('/auth/register/',{method:'POST',body:JSON.stringify(body)}),me:()=>api<User>('/auth/me/')};
export const queryKey={catalog:['catalog'],orders:['orders'],students:['students']};

/* ------------------------------------------------------------------ *
 * School Admin panel
 * ------------------------------------------------------------------ */
export type PanelSchool={id:string;name:string;code:string;city_name:string};
export type Money=string; // decimals come back as strings so nothing rounds twice
export type DashboardTotals={orders:number;units:number;gross_sales:Money;cost:Money;margin:Money;average_order_value:Money};
export type CategoryRow={category_id:string;category:string;orders:number;units:number;gross_sales:Money;share_pct:Money};
export type DailyPoint={date:string;orders:number;units:number;gross_sales:Money};
export type Commission={rate_set:boolean;rate:string|null;rate_display:string;basis:string;gross_sales:Money;commission_amount:Money|null;currency:string;note:string|null};
export type Dashboard={school:PanelSchool&{commission_rate:string|null};date_from:string;date_to:string;days:number;totals:DashboardTotals;categories:CategoryRow[];daily:DailyPoint[];commission:Commission;pending_students:number;notes:string[]};
export type PanelOrderItem={product:string;variant:string;quantity:number;category:string};
export type PanelOrder={id:string;order_number:string;student:string;student_name:string;student_gr:string;student_class:string;student_section:string;items:PanelOrderItem[];item_count:number;units:number;amount:Money;status:string;payment_status:string;fulfillment_type:string;created_at:string;placed_by:string|null;placed_by_name:string;placed_by_role:string;placed_by_role_label:string};
export type PanelStudent={id:string;name:string;gr_number:string;class_name:string;section:string;gender:string;date_of_birth:string|null;school:string;school_name:string;school_code:string;parent:string|null;parent_name:string;parent_phone:string;approval_status:'PENDING'|'APPROVED';source:string;active:boolean;created_at:string};
export type PanelTeacher={id:string;username:string;email:string;first_name:string;last_name:string;phone:string;role:Role;school:string;school_name:string;is_active:boolean;must_change_password:boolean;created_at:string;temporary_password?:string};
export type ExportJob={id:string;job_type:'ORDERS'|'STUDENTS';job_type_display:string;status:'QUEUED'|'RUNNING'|'READY'|'FAILED'|'EXPIRED';status_display:string;progress:number;school:string;school_code:string;requested_by_name:string|null;filters:Record<string,string>;filename:string;row_count:number;result:Record<string,unknown>;error_message:string;download_url:string|null;created_at:string;completed_at:string|null;expires_at:string|null};
export type FilterOptions={school:{id:string;name:string;code:string};classes:string[];sections:string[];categories:{id:string;name:string}[];statuses:{value:string;label:string}[];placed_by_roles:{value:string;label:string}[];default_date_from:string;default_date_to:string};
export type ImportJob={id:string;job_type:string;status:'PENDING'|'VALIDATING'|'PREVIEW_READY'|'IMPORTING'|'COMPLETED'|'FAILED';school:string;school_code:string|null;uploaded_by_name:string|null;original_filename:string;total_rows:number;valid_count:number;duplicate_count:number;error_count:number;preview:Record<string,unknown>;result:Record<string,unknown>;error_message:string;progress:number;created_at:string;completed_at:string|null};
export type Page<T>={next:string|null;previous:string|null;results:T[]};
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
  confirmImport:(school:string,id:string)=>api<ImportJob>(`/panel/student-imports/${id}/confirm/?school=${school}`,{method:'POST'}),
  importReportUrl:(school:string,id:string)=>`/panel/student-imports/${id}/report/?school=${school}`,
  importTemplateUrl:(school:string,fmt:'xlsx'|'csv')=>`/panel/student-imports/template/?school=${school}&format=${fmt}`,
};
export const money=(v:Money|number|null|undefined)=>{
  if(v===null||v===undefined) return '—';
  const n=typeof v==='number'?v:Number(v);
  if(Number.isNaN(n)) return String(v);
  return '₹'+n.toLocaleString('en-IN',{maximumFractionDigits:0});
};
export const money2=(v:Money|number|null|undefined)=>{
  if(v===null||v===undefined) return '—';
  const n=typeof v==='number'?v:Number(v);
  if(Number.isNaN(n)) return String(v);
  return '₹'+n.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
};
export const num=(v:Money|number|null|undefined)=>v===null||v===undefined?'—':Number(v).toLocaleString('en-IN');
