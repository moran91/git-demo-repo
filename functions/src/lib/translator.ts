import { applicationDefault } from 'firebase-admin/app';
import type { Locale } from '@qareeb/shared';

/** Translates a batch of HTML snippets (see protectNames) from one language to another, in order. */
export interface Translator {
  translate(html: string[], from: Locale, to: Locale): Promise<string[]>;
}

/**
 * Google Cloud Translation v3 with the function's own service account: no key to manage. HTML mode
 * so `<span translate="no">` keeps the business name as written.
 */
const cloudTranslator: Translator = {
  async translate(html, from, to) {
    if (html.length === 0) return [];
    const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
    const { access_token: token } = await applicationDefault().getAccessToken();
    const out: string[] = [];
    // The API accepts up to 1024 strings per request; menus stay far below that, chunk anyway.
    for (let i = 0; i < html.length; i += 500) {
      const res = await fetch(`https://translation.googleapis.com/v3/projects/${project}/locations/global:translateText`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': String(project) },
        body: JSON.stringify({ contents: html.slice(i, i + 500), sourceLanguageCode: from, targetLanguageCode: to, mimeType: 'text/html' }),
      });
      if (!res.ok) throw new Error(`translate ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { translations: Array<{ translatedText: string }> };
      out.push(...data.translations.map((t) => t.translatedText));
    }
    return out;
  },
};

/** The emulator never calls Google: "[ar] פסטה" makes translations visible and deterministic in tests. */
const stubTranslator: Translator = {
  async translate(html, _from, to) {
    return html.map((h) => `[${to}] ${h}`);
  },
};

export function getTranslator(): Translator {
  return process.env.FUNCTIONS_EMULATOR === 'true' ? stubTranslator : cloudTranslator;
}
