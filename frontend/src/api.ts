export type Role='PARENT'|'TEACHER'|'SCHOOL_ADMIN'|'ADMIN'|'BOSS';
export type User={id:string;username:string;role:Role;school?:{name:string};phone?:string};
export type StockStatus='IN_STOCK'|'LOW_STOCK'|'OUT_OF_STOCK';
export type Product={id:string;name:string;category:string;price:number;image?:string;thumbnail?:string|null;variants:{id:string;size:string;stock_status:StockStatus|null}[]};
export type Order={id:string;order_number:string;student_name:string;status:string;payment_status:string;total:number;created_at:string;status_events?:{status:string;timestamp:string}[]};
const API=import.meta.env.VITE_API_URL||'/api';
let refreshing:Promise<string>|null=null;
async function refresh(){const token=localStorage.getItem('refresh'); const r=await fetch(`${API}/auth/token/refresh/`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh:token})}); if(!r.ok) throw Error('session expired'); const d=await r.json(); localStorage.setItem('access',d.access); return d.access;}
export async function api<T>(path:string, init:RequestInit={},{retry=true}={}):Promise<T>{const headers=new Headers(init.headers); headers.set('Content-Type','application/json'); const access=localStorage.getItem('access'); if(access) headers.set('Authorization',`Bearer ${access}`); let res=await fetch(`${API}${path}`,{...init,headers}); if(res.status===401&&retry&&localStorage.getItem('refresh')){refreshing??=(refresh().finally(()=>{refreshing=null})); try{const token=await refreshing; return api<T>(path,{...init,headers:new Headers({...Object.fromEntries(headers),Authorization:`Bearer ${token}`})},{retry:false})}catch{logout();}} if(!res.ok) throw new Error((await res.json().catch(()=>({}))).detail||'Something went wrong'); return res.status===204?undefined as T:res.json();}
export function logout(){localStorage.removeItem('access');localStorage.removeItem('refresh'); window.location.href='/login';}
export const auth={login:(username:string,password:string)=>api<{access:string;refresh:string;user:User}>('/auth/token/',{method:'POST',body:JSON.stringify({username,password})}),register:(body:unknown)=>api<{access:string;refresh:string;user:User}>('/auth/register/',{method:'POST',body:JSON.stringify(body)}),me:()=>api<User>('/auth/me/')};
export const queryKey={catalog:['catalog'],orders:['orders'],students:['students']};
