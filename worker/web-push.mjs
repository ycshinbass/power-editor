// WebCrypto implementation of RFC 8291 aes128gcm and RFC 8292 VAPID.
// No persistent keys are generated here. Runtime env keys are supplied by deployment.
import {validatePushEndpoint} from './push.mjs';
const wpText=new TextEncoder();
export function pushBase64url(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
export function pushDecode(value,length){if(typeof value!=='string'||!/^[\w-]+$/.test(value)||value.length>1000)throw new Error('Invalid push key');let out;try{out=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0))}catch{throw new Error('Invalid push key')}if(length&&out.length!==length||pushBase64url(out)!==value)throw new Error('Invalid push key');return out}
function wpConcat(...parts){const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){result.set(p,i);i+=p.length}return result}
async function wpHmac(key,data){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,data))}
export async function importPushPrivate(publicValue,privateValue,algorithm='ECDH'){
 const pub=pushDecode(publicValue,65);pushDecode(privateValue,32);if(pub[0]!==4)throw new Error('Invalid push public key');
 return crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:pushBase64url(pub.slice(1,33)),y:pushBase64url(pub.slice(33)),d:privateValue,ext:true},{name:algorithm,namedCurve:'P-256'},false,algorithm==='ECDH'?['deriveBits']:['sign']);
}
export async function encryptWebPush(plaintext,subscription,{salt,keyPair}={}){
 if(!(plaintext instanceof Uint8Array)||plaintext.length>3993)throw new Error('Push payload too large');
 const ua=pushDecode(subscription.keys?.p256dh,65),auth=pushDecode(subscription.keys?.auth,16);if(ua[0]!==4)throw new Error('Invalid recipient key');
 const uaKey=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const pair=keyPair||await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const as=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:uaKey},pair.privateKey,256));
 const randomSalt=salt||crypto.getRandomValues(new Uint8Array(16));if(randomSalt.length!==16)throw new Error('Invalid salt');
 const prkKey=await wpHmac(auth,shared),ikm=await wpHmac(prkKey,wpConcat(wpText.encode('WebPush: info\0'),ua,as,new Uint8Array([1])));
 const prk=await wpHmac(randomSalt,ikm),cek=(await wpHmac(prk,wpText.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0,16),nonce=(await wpHmac(prk,wpText.encode('Content-Encoding: nonce\0\x01'))).slice(0,12);
 const aes=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},aes,wpConcat(plaintext,new Uint8Array([2]))));
 const header=wpConcat(randomSalt,new Uint8Array([0,0,16,0,65]),as);
 return wpConcat(header,ciphertext);
}
export async function vapidAuthorization(endpoint,env,now=Date.now()){
 const aud=new URL(validatePushEndpoint(endpoint)).origin;let subject;try{subject=new URL(env.VAPID_SUBJECT)}catch{throw new Error('Push not configured')}
 if(subject.protocol!=='https:'||subject.username||subject.password||subject.hash)throw new Error('Invalid VAPID subject');
 const publicBytes=pushDecode(env.VAPID_PUBLIC_KEY,65);const privateKey=await importPushPrivate(env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY,'ECDSA');
 const encoded=pushBase64url(wpText.encode(JSON.stringify({typ:'JWT',alg:'ES256'})))+'.'+pushBase64url(wpText.encode(JSON.stringify({aud,exp:Math.floor(now/1000)+43200,sub:subject.href})));
 const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,wpText.encode(encoded)));
 const verifyKey=await crypto.subtle.importKey('raw',publicBytes,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 if(signature.length!==64||!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},verifyKey,signature,wpText.encode(encoded)))throw new Error('Mismatched VAPID configuration');
 return `vapid t=${encoded}.${pushBase64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}
export function createWebPushSender(env,{fetcher=fetch,now=()=>Date.now()}={}){
 return async(subscription,payload,{timeoutMs=10000}={})=>{
  const endpoint=validatePushEndpoint(subscription.endpoint);
  const body=await encryptWebPush(wpText.encode(JSON.stringify(payload)),subscription);
  const authorization=await vapidAuthorization(endpoint,env,now());
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(100,Math.min(10000,timeoutMs)));
  try{const response=await fetcher(endpoint,{method:'POST',redirect:'manual',signal:controller.signal,headers:{Authorization:authorization,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:'3600',Urgency:'normal'},body});
   // Never consume/log potentially sensitive provider response bodies or endpoints.
   if(response.redirected)throw new Error('Push redirect rejected');try{await response.body?.cancel()}catch{}
   if(response.status>=300&&response.status<400)return {status:response.status,redirectRejected:true};
   return {status:response.status};
  }finally{clearTimeout(timer)}
 };
}
