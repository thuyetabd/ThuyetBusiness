class CookieImportError extends Error {}
// Accept common browser exports and Facebook appstate JSON. Never log values.
const isFacebookDomain = domain => typeof domain === 'string' && /^(?:[a-z0-9-]+\.)*facebook\.com$/i.test(domain.replace(/^\./, ''));
function parseCookies(text, now = Date.now() / 1000) {
  let input;
  try { input = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new CookieImportError('File không phải JSON hợp lệ.'); }
  const rows = Array.isArray(input) ? input : input?.cookies;
  if (!Array.isArray(rows) || rows.length > 5000) throw new CookieImportError('Cần mảng cookie JSON hoặc đối tượng có mảng cookies.');
  let skipped = 0;
  const result = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new CookieImportError('Có mục cookie không hợp lệ.');
    const domain = row.domain || (row.key ? '.facebook.com' : '');
    if (!isFacebookDomain(domain)) { skipped++; continue; }
    const name = row.name ?? row.key;
    const value = row.value;
    if (typeof name !== 'string' || !name || /[\x00-\x20\x7f()<>@,;:\\"/\[\]?={}]/.test(name) || typeof value !== 'string' || /[\x00-\x1f\x7f;]/.test(value)) throw new CookieImportError('Có tên hoặc giá trị cookie Facebook không hợp lệ.');
    const host = domain.replace(/^\./, '').toLowerCase();
    const cookiePath = row.path || '/';
    if (typeof cookiePath !== 'string' || !cookiePath.startsWith('/') || /[\r\n?#]/.test(cookiePath)) throw new CookieImportError('Đường dẫn cookie không hợp lệ.');
    const cookie = {url:`https://${host}${cookiePath}`,name,value,path:cookiePath,secure:row.secure !== false,httpOnly:row.httpOnly === true || row.httpOnly === 'true'};
    if (row.hostOnly !== true && !name.startsWith('__Host-')) cookie.domain = domain.toLowerCase();
    const sameSite = String(row.sameSite || 'unspecified').toLowerCase();
    const mapping = {none:'no_restriction',no_restriction:'no_restriction',lax:'lax',strict:'strict',unspecified:'unspecified'};
    cookie.sameSite = mapping[sameSite] || 'unspecified';
    if (cookie.sameSite === 'no_restriction' || name.startsWith('__Secure-') || name.startsWith('__Host-')) cookie.secure = true;
    if (name.startsWith('__Host-')) cookie.path = '/';
    let expires = row.expirationDate ?? row.expires ?? row.expiration;
    if (row.session !== true && expires !== undefined && expires !== null && expires !== -1 && expires !== '-1') {
      expires = Number(expires);
      if (!Number.isFinite(expires)) throw new CookieImportError('Hạn cookie không hợp lệ.');
      if (expires > 1e12) expires /= 1000;
      if (expires <= now) { skipped++; continue; }
      cookie.expirationDate = expires;
    }
    result.set(`${cookie.domain || host}|${cookie.path}|${name}`,cookie);
  }
  const cookies = [...result.values()];
  if (!cookies.some(c => c.name === 'c_user' && c.value) || !cookies.some(c => c.name === 'xs' && c.value)) throw new CookieImportError('Thiếu cookie đăng nhập c_user hoặc xs còn hạn. Hãy xuất lại cookie Facebook đầy đủ.');
  if (new Set(cookies.filter(c => c.name === 'c_user').map(c => c.value)).size > 1) throw new CookieImportError('File chứa nhiều tài khoản Facebook. Hãy xuất cookie của một tài khoản.');
  return {cookies,skipped};
}
function restoreDetails(c) {
  const out = {url:`https://${c.domain.replace(/^\./,'')}${c.path || '/'}`,name:c.name,value:c.value,path:c.path,secure:c.secure,httpOnly:c.httpOnly,sameSite:c.sameSite};
  if (!c.hostOnly) out.domain = c.domain;
  if (c.expirationDate !== undefined) out.expirationDate = c.expirationDate;
  return out;
}
async function replaceFacebookCookies(jar, cookies) {
  const previous = (await jar.get({})).filter(c => isFacebookDomain(c.domain));
  const removeAll = async () => {
    const current = (await jar.get({})).filter(c => isFacebookDomain(c.domain));
    for (const c of current) await jar.remove(`https://${c.domain.replace(/^\./,'')}${c.path || '/'}`, c.name);
  };
  try {
    await removeAll();
    for (const cookie of cookies) await jar.set(cookie);
    await jar.flushStore();
  } catch {
    try {
      await removeAll();
      for (const c of previous) await jar.set(restoreDetails(c));
      await jar.flushStore();
    } catch { throw new CookieImportError('Nhập cookie thất bại và không khôi phục được phiên cũ. Hãy đăng nhập lại.'); }
    throw new CookieImportError('Không nhập được cookie. Phiên đăng nhập cũ đã được khôi phục.');
  }
}
module.exports = {parseCookies,replaceFacebookCookies,CookieImportError};
