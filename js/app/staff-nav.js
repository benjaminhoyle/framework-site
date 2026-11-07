/*
 * A way back to the staff app from the older private pages (/elvis, /metrics, /marketing,
 * the studios). Those keep their own layouts, so this is one small button in a corner
 * rather than a bar that might sit on top of something. It appears only for someone signed
 * in, so a page opened with the old key looks as it always did.
 */
(function () {
  'use strict';
  if (!/(?:^|;\s*)fw_staff=1/.test(document.cookie)) return;
  const a = document.createElement('a');
  a.href = '/app';
  a.setAttribute('aria-label', 'Staff app');
  a.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>';
  a.style.cssText = 'position:fixed;left:max(12px,env(safe-area-inset-left,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:9999;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:#fff;color:#245d5f;border:1px solid #e1e7e5;box-shadow:0 2px 10px rgba(0,0,0,.14)';
  document.body.appendChild(a);
}());
