import { resolveTenant } from './tenant';
import {
  Skin,
  skinSchema,
  SkinHooksModule,
  WebChatConfig,
  WebChatExports,
  WebChatStore
} from './types';
import { resolveDirectLineConfig } from './lib/directline';
import { watchWebChatConnection } from './state/connection';

const WEBCHAT_CDN = 'https://cdn.botframework.com/botframework-webchat/latest/webchat.js';
const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '') + '/';
const ALLOWED_PUBLIC_PROTOCOLS = new Set(['http:', 'https:']);

let webChatPromise: Promise<WebChatExports> | undefined;
const hooksCache = new Map<string, Promise<SkinHooksModule>>();

export interface PreparedExperience {
  tenant: string;
  mode: 'fullpage' | 'widget';
  skin: Skin;
  shellHtml?: string;
  renderWebChat: (target: HTMLElement) => Promise<void>;
}

export async function prepareExperience(): Promise<PreparedExperience> {
  const { tenant, isEmbed } = resolveTenant(window.location.pathname);
  const skin = await fetchSkin(tenant);
  const mode: 'fullpage' | 'widget' = isEmbed ? 'widget' : skin.mode;

  applyBranding(skin);
  if (mode === 'fullpage') {
    applyFullPageCss(skin.fullpage.css);
  } else {
    clearFullPageCss();
  }

  const shellPromise =
    mode === 'fullpage'
      ? fetchFullPageShell(resolvePublicUrl(skin.fullpage.index))
      : Promise.resolve<string | undefined>(undefined);

  const [webChat, directLineConfig, styleOptions, hostConfig, hooksModule, shellHtml] = await Promise.all([
    ensureWebChatLoaded(),
    resolveDirectLineConfig(skin.directLine.tokenUrl, skin.directLine.domain),
    fetchJson<Record<string, unknown>>(skin.webchat.styleOptions),
    fetchJson<Record<string, unknown>>(skin.webchat.adaptiveCardsHostConfig),
    loadHooks(skin.hooks?.script),
    shellPromise
  ]);

  return {
    tenant,
    mode,
    skin,
    // shellHtml is served from a tenant-controlled template, not user input.
    shellHtml,
    renderWebChat: async (target: HTMLElement) => {
      if (!target) {
        throw new Error('Missing WebChat mount node');
      }

      const directLineConfigOptions = {
        token: directLineConfig.token,
        webSocket: false,
        pollingInterval: 2000,
        ...(directLineConfig.domain ? { domain: directLineConfig.domain } : {})
      };
      const directLine = webChat.createDirectLine(directLineConfigOptions);
      const config: WebChatConfig = {
        directLine,
        locale: skin.webchat.locale ?? 'en-US',
        styleOptions,
        adaptiveCardsHostConfig: hostConfig
      };

      // Middleware that converts Action.Execute into postBack so WebChat can handle it,
      // shows a spinner on the clicked AC button while waiting for a response,
      // and auto-scrolls to bottom on new incoming activities.
      const coreMiddleware: StoreMiddleware = (store) => next => action => {
        const a = action as {
          type?: string;
          payload?: {
            cardAction?: { type?: string; value?: unknown; verb?: string; data?: unknown };
            activity?: { from?: { role?: string } };
          };
        };

        // Convert Action.Execute → postBack
        if (
          a.type === 'WEB_CHAT/SEND_MESSAGE' &&
          a.payload?.cardAction?.type === 'execute'
        ) {
          const ca = a.payload.cardAction;
          return next({
            ...a,
            payload: {
              ...a.payload,
              cardAction: {
                type: 'postBack',
                value: ca.data ?? ca.value ?? { verb: ca.verb }
              }
            }
          });
        }

        // Patch incoming AC attachments before WebChat renders them:
        // - Rewrite relative URLs to absolute (OpenUrl fix)
        // - Convert Action.Execute → Action.Submit (WebChat compat)
        if (a.type === 'DIRECT_LINE/INCOMING_ACTIVITY') {
          patchIncomingActivity(a.payload?.activity);
        }

        // Card action sent → show spinner on the last clicked AC button
        if (
          a.type === 'WEB_CHAT/SEND_POST_BACK' ||
          a.type === 'WEB_CHAT/SEND_MESSAGE_BACK' ||
          (a.type === 'WEB_CHAT/SEND_MESSAGE' && a.payload?.cardAction)
        ) {
          showButtonSpinner(target);
        }

        // Let the action through first so WebChat processes + renders it
        const result = next(action);

        // Bot response arrived → clear spinners + scroll to bottom via SDK
        if (
          a.type === 'DIRECT_LINE/INCOMING_ACTIVITY' &&
          a.payload?.activity?.from?.role === 'bot'
        ) {
          clearButtonSpinners(target);
          setTimeout(() => store.dispatch({ type: 'WEB_CHAT/SCROLL_TO_END' }), 100);
          setTimeout(() => store.dispatch({ type: 'WEB_CHAT/SCROLL_TO_END' }), 500);
        }

        return result;
      };

      const skinMiddleware = hooksModule?.createStoreMiddleware?.();
      const middlewares: StoreMiddleware[] = [coreMiddleware];
      if (skinMiddleware) {
        middlewares.push(skinMiddleware);
      }

      let store: WebChatStore | undefined;
      if (webChat.createStore) {
        store = webChat.createStore({}, ...middlewares);
        if (store) {
          config.store = store;
        }
      }

      watchWebChatConnection(store, directLine as {
        connectionStatus$?: {
          subscribe: (listener: (status: unknown) => void) => { unsubscribe?: () => void };
        };
      });

      await hooksModule?.onBeforeRender?.({ tenant, skin, webchatConfig: config });
      webChat.renderWebChat(config, target);
    }
  };
}

async function fetchSkin(tenant: string): Promise<Skin> {
  const response = await fetch(resolvePublicUrl(`skins/${tenant}/skin.json`), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to load skin for tenant "${tenant}"`);
  }
  const json = await response.json();
  return skinSchema.parse(json);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(resolvePublicUrl(url), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return (await response.json()) as T;
}

async function fetchFullPageShell(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to load full page template at ${url}`);
  }
  const html = await response.text();
  return rewriteShellHtml(html);
}

async function ensureWebChatLoaded(): Promise<WebChatExports> {
  if (window.WebChat) {
    return window.WebChat;
  }

  if (!webChatPromise) {
    webChatPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = WEBCHAT_CDN;
      script.async = true;
      script.onload = () => {
        if (window.WebChat) {
          resolve(window.WebChat);
        } else {
          reject(new Error('WebChat script loaded without exposing window.WebChat'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load BotFramework WebChat script.'));
      document.head.appendChild(script);
    });
  }

  return webChatPromise;
}

async function loadHooks(script?: string): Promise<SkinHooksModule | undefined> {
  if (!script) {
    return undefined;
  }
  const url = resolvePublicUrl(script);
  if (!hooksCache.has(url)) {
    hooksCache.set(
      url,
      (async () => {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Unable to fetch hooks file at ${url}`);
        }
        const code = await response.text();
        const blob = new Blob([`${code}\n//# sourceURL=${url}`], { type: 'text/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        try {
          const module = await import(/* @vite-ignore */ blobUrl);
          return module as SkinHooksModule;
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      })()
    );
  }
  try {
    return await hooksCache.get(url);
  } catch (error) {
    console.error('Unable to load hooks module', error);
    throw error;
  }
}

function applyBranding(skin: Skin) {
  document.title = `${skin.brand.name} · WebChat`;
  document.documentElement.style.setProperty('--brand-primary', skin.brand.primary);
  setFavicon(skin.brand.favicon);
}

function setFavicon(href: string) {
  let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = resolvePublicUrl(href);
}

let cssHandle: HTMLLinkElement | undefined;

function applyFullPageCss(href: string) {
  const resolved = resolvePublicUrl(href);
  if (cssHandle && cssHandle.href === new URL(resolved, window.location.origin).href) {
    return;
  }
  if (cssHandle) {
    cssHandle.remove();
  }
  cssHandle = document.createElement('link');
  cssHandle.rel = 'stylesheet';
  cssHandle.href = resolved;
  cssHandle.dataset.skinCss = 'true';
  document.head.appendChild(cssHandle);
}

function clearFullPageCss() {
  if (cssHandle) {
    cssHandle.remove();
    cssHandle = undefined;
  }
}

function getRuntimeBase(): string {
  if (typeof window !== 'undefined' && window.__BASE_PATH__) {
    const candidate = window.__BASE_PATH__;
    return candidate.endsWith('/') ? candidate : `${candidate}/`;
  }
  return base;
}

function assertSafeProtocol(url: string): void {
  try {
    const baseForValidation =
      typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://localhost';
    const parsed = new URL(url, baseForValidation);
    if (!ALLOWED_PUBLIC_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
  } catch (error) {
    throw new Error(`Blocked unsafe URL "${url}": ${(error as Error).message}`);
  }
}

export function resolvePublicUrl(input: string): string {
  if (!input) {
    throw new Error('Cannot resolve empty URL');
  }
  const absolute = input.trim();
  const resolved = /^https?:/i.test(absolute)
    ? absolute
    : `${getRuntimeBase()}${absolute.replace(/^\/+/, '')}`;

  assertSafeProtocol(resolved);
  return resolved;
}

function rewriteShellHtml(html: string): string {
  return html
    .replace(/(src|href)=(['"])\/(skins\/[^'"]+)\2/g, (_match, attr, quote, path) => {
      return `${attr}=${quote}${resolvePublicUrl(path)}${quote}`;
    })
    .replace(/url\((['"]?)\/(skins\/[^)'"]+)\1\)/g, (_match, quote, path) => {
      const q = quote || '';
      return `url(${q}${resolvePublicUrl(path)}${q})`;
    });
}

// ── Button spinner + auto-scroll helpers ──

/** Mark the most recently focused/clicked AC button as loading. */
function showButtonSpinner(root: HTMLElement) {
  // The browser sets :focus on the clicked button before the store action fires.
  const focused = root.querySelector('.ac-pushButton:focus') as HTMLElement | null;
  const btn = focused ?? root.querySelector('.ac-pushButton:last-of-type') as HTMLElement | null;
  if (btn && !btn.classList.contains('is-loading')) {
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
  }
}

/** Remove loading state from all AC buttons. */
function clearButtonSpinners(root: HTMLElement) {
  root.querySelectorAll('.ac-pushButton.is-loading').forEach(btn => {
    btn.classList.remove('is-loading');
    btn.removeAttribute('aria-busy');
  });
}

const RELATIVE_URL_RE = /^\/[^/]/;

/** Patch an incoming activity's AC attachments before WebChat renders them. */
function patchIncomingActivity(activity: unknown) {
  if (!activity || typeof activity !== 'object') return;
  const act = activity as { attachments?: Array<{ content?: unknown }> };
  if (!Array.isArray(act.attachments)) return;
  for (const att of act.attachments) {
    if (att.content && typeof att.content === 'object') {
      deepPatchCard(att.content as Record<string, unknown>);
    }
  }
}

/**
 * Recursively walk an AC JSON object and:
 * 1. Resolve relative URLs to absolute (fixes OpenUrl block)
 * 2. Convert Action.Execute → Action.Submit (fixes "unknown action" error)
 */
function deepPatchCard(obj: Record<string, unknown>) {
  for (const key of Object.keys(obj)) {
    const val = obj[key];

    // Resolve relative URLs
    if (typeof val === 'string' && RELATIVE_URL_RE.test(val) && (key === 'url' || key === 'value' || key === 'iconUrl')) {
      obj[key] = new URL(val, window.location.origin).href;
    }

    // Convert Action.Execute → Action.Submit
    if (key === 'type' && val === 'Action.Execute') {
      obj[key] = 'Action.Submit';
      // Move "data" to "data" (Submit uses data, Execute uses data too, but ensure it's there)
      if (obj['data'] === undefined && obj['verb'] !== undefined) {
        obj['data'] = { verb: obj['verb'] };
      }
    }

    // Recurse into arrays
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object') {
          deepPatchCard(item as Record<string, unknown>);
        }
      }
    // Recurse into objects
    } else if (val && typeof val === 'object') {
      deepPatchCard(val as Record<string, unknown>);
    }
  }
}

